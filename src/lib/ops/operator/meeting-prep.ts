import { readState, writeState } from "@/lib/ops/state";
import { readEmail, searchEmails } from "@/lib/ops/gmail-reader";
import { ABRA_CONTROL_CHANNEL_ID } from "@/lib/ops/operator/reports/shared";

type BrainMeetingRow = {
  id: string;
  title?: string | null;
  raw_text?: string | null;
  summary_text?: string | null;
  created_at?: string | null;
};

type MeetingPrepResult = {
  generated: number;
};

const STATE_KEY = "abra-operator-meeting-prep-log" as never;
const DOSSIER_STATE_KEY = "abra:powers_dossier_last_built" as never;

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }
  return { baseUrl, serviceKey };
}

async function sbFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const env = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(15000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status})`);
  }
  return json as T;
}

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

function getSlackToken(): string {
  return (process.env.SLACK_BOT_TOKEN || "").trim();
}

async function postSlackMessage(text: string): Promise<void> {
  const token = getSlackToken();
  if (!token) return;
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: ABRA_CONTROL_CHANNEL_ID,
      text,
      mrkdwn: true,
      unfurl_links: false,
    }),
    signal: AbortSignal.timeout(12000),
  }).catch(() => {});
}

function extractMeetingDate(text: string, now = new Date()): string | null {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  if (/march\s+26/i.test(text)) return "2026-03-26";
  if (/wednesday/i.test(text)) {
    const current = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const day = current.getDay();
    const delta = (3 - day + 7) % 7 || 7;
    const target = new Date(current.getTime() + delta * 24 * 60 * 60 * 1000);
    return target.toISOString().slice(0, 10);
  }
  return null;
}

function within48Hours(dateIso: string, now = new Date()): boolean {
  const target = new Date(`${dateIso}T17:00:00-07:00`).getTime();
  const current = now.getTime();
  return target >= current && target - current <= 48 * 60 * 60 * 1000;
}

async function generatePrep(prompt: string): Promise<string> {
  const res = await fetch(`${getInternalBaseUrl()}/api/ops/abra/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getInternalHeaders(),
    },
    body: JSON.stringify({
      message: prompt,
      history: [],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(55000),
  });
  if (!res.ok) {
    throw new Error(`Abra chat meeting prep failed (${res.status})`);
  }
  const data = (await res.json().catch(() => ({}))) as { reply?: string };
  return String(data.reply || "").trim();
}

async function upsertBrainEntry(title: string, sourceRef: string, rawText: string, summaryText: string): Promise<void> {
  const existing = await sbFetch<Array<{ id: string }>>(
    `/rest/v1/open_brain_entries?source_ref=eq.${encodeURIComponent(sourceRef)}&select=id&limit=1`,
  ).catch(() => []);
  const payload = {
    source_type: "manual",
    source_ref: sourceRef,
    entry_type: "teaching",
    title,
    raw_text: rawText,
    summary_text: summaryText.slice(0, 1000),
    category: "operational",
    department: "executive",
    tags: ["powers", "greg", "meeting-dossier"],
    processed: true,
  };
  if (existing[0]?.id) {
    await sbFetch(`/rest/v1/open_brain_entries?id=eq.${existing[0].id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }).catch(() => {});
    return;
  }
  await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export async function buildPowersEmailDossier(): Promise<string> {
  const lastBuilt = await readState<{ built_at?: string } | null>(DOSSIER_STATE_KEY, null).catch(() => null);
  if (lastBuilt?.built_at && Date.now() - Date.parse(lastBuilt.built_at) < 12 * 60 * 60 * 1000) {
    return "Powers email dossier already refreshed today.";
  }
  const envelopes = await searchEmails("from:gregk@powers-inc.com", 25).catch(() => []);
  const emails = await Promise.all(
    (Array.isArray(envelopes) ? envelopes : []).slice(0, 20).map(async (envelope) => readEmail(envelope.id).catch(() => null)),
  );
  const timeline = emails
    .filter((email): email is NonNullable<typeof email> => Boolean(email))
    .map((email) => [
      `Date: ${email.date}`,
      `Subject: ${email.subject}`,
      `From: ${email.from}`,
      `To: ${email.to}`,
      String(email.body || "").slice(0, 1200),
    ].join("\n"))
    .join("\n\n---\n\n");

  if (!timeline.trim()) return "No Greg/Powers emails found for dossier.";

  const dossier = await generatePrep(
    [
      "Generate a complete relationship dossier for Powers Confections based on Greg's emails.",
      "Include: timeline of interactions, every price/quote mentioned, commitments made, open questions, attachment references.",
      "Be factual and concise.",
      "",
      timeline,
    ].join("\n"),
  ).catch(() => "");

  const raw = dossier || timeline.slice(0, 12000);
  await upsertBrainEntry(
    "Powers Confections — Complete Email Dossier",
    "powers-email-dossier",
    raw,
    raw.slice(0, 1000),
  );
  await writeState(DOSSIER_STATE_KEY, { built_at: new Date().toISOString() }).catch(() => {});
  return raw;
}

async function collectPowersContext(): Promise<string> {
  const [emails, brainRows] = await Promise.all([
    searchEmails("from:gregk@powers-inc.com newer_than:30d", 5).catch(() => []),
    sbFetch<BrainMeetingRow[]>(
      `/rest/v1/open_brain_entries?select=id,title,raw_text,summary_text,created_at&or=(title.ilike.*powers*,raw_text.ilike.*powers*)&order=created_at.desc&limit=12`,
    ).catch(() => []),
  ]);

  const emailContext = (Array.isArray(emails) ? emails : [])
    .map((email) => `From: ${email.from}\nDate: ${email.date}\nSubject: ${email.subject}\n${String(email.body || "").slice(0, 500)}`)
    .join("\n\n---\n\n");

  const brainContext = (Array.isArray(brainRows) ? brainRows : [])
    .map((row) => `${row.title || ""}\n${String(row.raw_text || row.summary_text || "").slice(0, 400)}`)
    .join("\n\n---\n\n");

  return [
    "Open questions to cover:",
    "- shelf life",
    "- film seal",
    "- co-packing rate",
    "- production timeline",
    "",
    "Recent Greg/Powers emails:",
    emailContext || "(none found)",
    "",
    "Relevant brain entries:",
    brainContext || "(none found)",
  ].join("\n");
}

export async function runMeetingPrepAutoGeneration(): Promise<MeetingPrepResult> {
  await buildPowersEmailDossier().catch(() => "");
  const rows = await sbFetch<BrainMeetingRow[]>(
    `/rest/v1/open_brain_entries?select=id,title,raw_text,summary_text,created_at&or=(title.ilike.*meeting*,raw_text.ilike.*meeting*)&order=created_at.desc&limit=40`,
  ).catch(() => []);

  const state = await readState<Record<string, string>>(STATE_KEY, {});
  const candidates = (Array.isArray(rows) ? rows : []).filter((row) => {
    const text = `${row.title || ""}\n${row.raw_text || row.summary_text || ""}`;
    const dateIso = extractMeetingDate(text);
    if (!dateIso) return false;
    if (!within48Hours(dateIso)) return false;
    return /powers/i.test(text);
  });

  let generated = 0;
  for (const row of candidates) {
    const text = `${row.title || ""}\n${row.raw_text || row.summary_text || ""}`;
    const dateIso = extractMeetingDate(text);
    if (!dateIso) continue;
    const meetingId = `powers:${dateIso}`;
    if (state[meetingId]) continue;

    const context = await collectPowersContext();
    const prep = await generatePrep(
      [
        "Generate a meeting prep document for the Powers Confections meeting.",
        "Include: open questions, Greg's recent emails summarized, decisions needed, negotiation points, what to bring.",
        "",
        `Meeting context:\n${text}`,
        "",
        context,
      ].join("\n"),
    ).catch(() => "");

    const message = prep
      ? `📋 Powers meeting prep ready for ${dateIso}.\n\n${prep.slice(0, 2800)}`
      : `📋 Powers meeting prep ready for ${dateIso}. I compiled the recent Powers context and open questions, but the generated summary failed.`;
    await postSlackMessage(message);
    state[meetingId] = new Date().toISOString();
    generated += 1;
  }

  if (generated > 0) {
    await writeState(STATE_KEY, state);
  }
  return { generated };
}
