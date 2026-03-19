import { getUnresolvedDeadLetters, type DeadLetter } from "@/lib/ops/abra-auto-teach";
import { kv } from "@vercel/kv";
import { notify } from "@/lib/ops/notify";

export type IntegrationStatus = {
  system_name: string;
  connection_status: "connected" | "expired" | "error" | "not_configured";
  last_success_at: string | null;
  last_error_at: string | null;
  error_summary: string | null;
  retry_count: number;
};

export type FeedHealthSummary = {
  feeds: Array<{
    feed_key: string;
    is_active: boolean;
    last_run_at: string | null;
    last_status: string | null;
    consecutive_failures: number;
    schedule_cron: string;
  }>;
  dead_letters: DeadLetter[];
  total_feeds: number;
  active: number;
  disabled: number;
  unresolved_dead_letters: number;
};

export type SystemHealth = {
  integrations: IntegrationStatus[];
  feeds: FeedHealthSummary;
  uptime: { healthy: number; degraded: number; down: number };
  last_checked: string;
};

const INTEGRATION_ALERT_TTL_SECONDS = 30 * 60;

function slugifyKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function integrationAlertKey(systemName: string): string {
  return `abra:health:alerted:${slugifyKey(systemName || "unknown")}`;
}

function integrationAlertFingerprint(integration: IntegrationStatus): string {
  return JSON.stringify({
    status: integration.connection_status,
    error: (integration.error_summary || "unknown error").slice(0, 200),
    last_error_at: integration.last_error_at || "",
  });
}

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Supabase not configured");
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!res.ok) {
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }

  return json;
}

async function getIntegrations(): Promise<IntegrationStatus[]> {
  try {
    const rows = (await sbFetch(
      "/rest/v1/integration_health?select=system_name,connection_status,last_success_at,last_error_at,error_summary,retry_count&order=system_name.asc",
    )) as IntegrationStatus[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function getFeedSummary(): Promise<FeedHealthSummary> {
  let feeds: FeedHealthSummary["feeds"] = [];
  try {
    const rows = (await sbFetch(
      "/rest/v1/abra_auto_teach_feeds?select=feed_key,is_active,last_run_at,last_status,consecutive_failures,schedule_cron&order=feed_key.asc",
    )) as Array<{
      feed_key: string;
      is_active: boolean;
      last_run_at: string | null;
      last_status: string | null;
      consecutive_failures: number | null;
      schedule_cron: string | null;
    }>;
    feeds = Array.isArray(rows)
      ? rows.map((row) => ({
          feed_key: row.feed_key,
          is_active: !!row.is_active,
          last_run_at: row.last_run_at,
          last_status: row.last_status,
          consecutive_failures: Number(row.consecutive_failures || 0),
          schedule_cron: row.schedule_cron || "",
        }))
      : [];
  } catch {
    feeds = [];
  }

  const deadLetters = await getUnresolvedDeadLetters();
  return {
    feeds,
    dead_letters: deadLetters,
    total_feeds: feeds.length,
    active: feeds.filter((feed) => feed.is_active).length,
    disabled: feeds.filter((feed) => !feed.is_active).length,
    unresolved_dead_letters: deadLetters.length,
  };
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const [integrations, feeds] = await Promise.all([
    getIntegrations(),
    getFeedSummary(),
  ]);

  const healthyIntegrations = integrations.filter(
    (item) => item.connection_status === "connected",
  ).length;
  const downIntegrations = integrations.filter(
    (item) => item.connection_status === "error",
  ).length;
  const degradedIntegrations = integrations.filter(
    (item) =>
      item.connection_status === "expired" ||
      item.connection_status === "not_configured",
  ).length;
  const feedDegraded = feeds.feeds.filter(
    (feed) => feed.is_active && feed.consecutive_failures > 0,
  ).length;

  return {
    integrations,
    feeds,
    uptime: {
      healthy: healthyIntegrations,
      degraded: degradedIntegrations + feedDegraded,
      down: downIntegrations + feeds.disabled,
    },
    last_checked: new Date().toISOString(),
  };
}

async function markDeadLetterAlerted(id: string): Promise<void> {
  try {
    await sbFetch(`/rest/v1/abra_feed_dead_letters?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ retry_count: 1 }),
    });
  } catch {
    // best-effort
  }
}

export async function checkAndAlertHealth(): Promise<void> {
  const health = await getSystemHealth();
  const now = Date.now();

  for (const integration of health.integrations) {
    const dedupKey = integrationAlertKey(integration.system_name);

    if (integration.connection_status !== "error" || !integration.last_error_at) {
      try {
        const previousFingerprint = await kv.get<string>(dedupKey);
        if (previousFingerprint) {
          await notify({
            channel: "alerts",
            text: `✅ ${integration.system_name} integration recovered.`,
          });
          await kv.del(dedupKey);
        }
      } catch {
        // Recovery tracking is best-effort.
      }
      continue;
    }
    const errorAt = new Date(integration.last_error_at).getTime();
    if (!Number.isFinite(errorAt)) continue;
    if (now - errorAt > 60 * 60 * 1000) continue;

    const fingerprint = integrationAlertFingerprint(integration);
    try {
      const previousFingerprint = await kv.get<string>(dedupKey);
      if (previousFingerprint === fingerprint) continue;
    } catch {
      // KV unavailable — fail open and still send the alert.
    }

    await notify({
      channel: "alerts",
      text: `⚠️ ${integration.system_name} integration is DOWN: ${integration.error_summary || "unknown error"}`,
    });

    try {
      await kv.set(dedupKey, fingerprint, { ex: INTEGRATION_ALERT_TTL_SECONDS });
    } catch {
      // best-effort
    }
  }

  const deadLetterByFeed = new Map<string, DeadLetter>();
  for (const dead of health.feeds.dead_letters) {
    if (!deadLetterByFeed.has(dead.feed_key)) {
      deadLetterByFeed.set(dead.feed_key, dead);
    }
  }

  for (const feed of health.feeds.feeds.filter((item) => !item.is_active)) {
    const deadLetter = deadLetterByFeed.get(feed.feed_key);
    if (!deadLetter) continue;
    if ((deadLetter.retry_count || 0) > 0) continue;

    await notify({
      channel: "alerts",
      text: `🚨 Feed ${feed.feed_key} is disabled (${feed.consecutive_failures} consecutive failures).`,
    });
    await markDeadLetterAlerted(deadLetter.id);
  }
}
