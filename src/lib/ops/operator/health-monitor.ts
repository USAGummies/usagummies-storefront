import { forceRefreshTokens } from "@/lib/ops/qbo-auth";
import { listEmails } from "@/lib/ops/gmail-reader";
import { notify } from "@/lib/ops/notify";

export type OperatorHealthCheck = {
  name: "qbo" | "slack" | "gmail" | "supabase" | "brain";
  ok: boolean;
  detail: string;
};

export type OperatorHealthSummary = {
  ok: boolean;
  checks: OperatorHealthCheck[];
};

function getInternalBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    "https://www.usagummies.com"
  );
}

function getInternalHeaders(): HeadersInit {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  return cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {};
}

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Missing Supabase credentials");
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}) {
  const env = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(12000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

const ABRA_CONTROL_CHANNEL = process.env.SLACK_CHANNEL_ALERTS || "C0ALS6W7VB4";

async function postSlackProbe(): Promise<void> {
  const token = (process.env.SLACK_BOT_TOKEN || "").trim();
  if (!token) throw new Error("SLACK_BOT_TOKEN missing");

  const postRes = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: ABRA_CONTROL_CHANNEL,
      text: "🩺 Abra operator health probe",
    }),
    signal: AbortSignal.timeout(10000),
  });
  const postData = (await postRes.json().catch(() => ({}))) as { ok?: boolean; ts?: string; error?: string };
  if (!postRes.ok || !postData.ok || !postData.ts) {
    throw new Error(postData.error || `Slack post failed (${postRes.status})`);
  }

  await fetch("https://slack.com/api/chat.delete", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: ABRA_CONTROL_CHANNEL,
      ts: postData.ts,
    }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {});
}

async function checkQBO(): Promise<OperatorHealthCheck> {
  const baseUrl = getInternalBaseUrl();
  const headers = getInternalHeaders();
  const vendorsRes = await fetch(`${baseUrl}/api/ops/qbo/query?type=vendors`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (vendorsRes.ok) {
    return { name: "qbo", ok: true, detail: "QBO vendors query passed" };
  }

  if (vendorsRes.status === 401) {
    const authorizeRes = await fetch(`${baseUrl}/api/ops/qbo/authorize`, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    const refreshed = await forceRefreshTokens().catch(() => null);
    if (refreshed) {
      const retry = await fetch(`${baseUrl}/api/ops/qbo/query?type=vendors`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (retry.ok) {
        return { name: "qbo", ok: true, detail: "QBO token refresh succeeded" };
      }
    }

    const authState = authorizeRes
      ? authorizeRes.status >= 300 && authorizeRes.status < 400
        ? "QBO auth expired — needs re-authorization"
        : `QBO authorize check returned ${authorizeRes.status}`
      : "QBO authorize check failed";
    return { name: "qbo", ok: false, detail: authState };
  }

  return { name: "qbo", ok: false, detail: `QBO vendors query failed (${vendorsRes.status})` };
}

async function checkSlack(): Promise<OperatorHealthCheck> {
  await postSlackProbe();
  return { name: "slack", ok: true, detail: "Slack probe passed" };
}

async function checkGmail(): Promise<OperatorHealthCheck> {
  await listEmails({ count: 1 });
  return { name: "gmail", ok: true, detail: "Gmail probe passed" };
}

async function checkSupabase(): Promise<OperatorHealthCheck> {
  await sbFetch("/rest/v1/abra_operator_tasks?select=id&limit=1");
  return { name: "supabase", ok: true, detail: "Supabase operator_tasks probe passed" };
}

async function checkBrain(): Promise<OperatorHealthCheck> {
  await sbFetch("/rest/v1/open_brain_entries?select=id&limit=1");
  return { name: "brain", ok: true, detail: "Brain probe passed" };
}

async function runCheck(name: OperatorHealthCheck["name"], fn: () => Promise<OperatorHealthCheck>): Promise<OperatorHealthCheck> {
  try {
    return await fn();
  } catch (error) {
    return {
      name,
      ok: false,
      detail: error instanceof Error ? error.message : `${name} check failed`,
    };
  }
}

export async function runOperatorHealthMonitor(): Promise<OperatorHealthSummary> {
  const checks = await Promise.all([
    runCheck("qbo", checkQBO),
    runCheck("slack", checkSlack),
    runCheck("gmail", checkGmail),
    runCheck("supabase", checkSupabase),
    runCheck("brain", checkBrain),
  ]);

  for (const check of checks.filter((item) => !item.ok)) {
    await notify({
      channel: "alerts",
      text: `⚠️ [system] ${check.name} is DOWN — ${check.detail}. Attempting recovery...`,
    }).catch(() => {});

    if (check.name === "qbo") {
      const refreshed = await forceRefreshTokens().catch(() => null);
      if (!refreshed) {
        await notify({
          channel: "alerts",
          text: "QBO needs manual re-authorization at /api/ops/qbo/authorize",
        }).catch(() => {});
      }
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
}
