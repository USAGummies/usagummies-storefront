import { createHash } from "node:crypto";

type DedupType = "event" | "response" | "message";

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
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return json as T;
}

function makeHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function buildSlackDedupRowId(
  dedupKey: string,
  dedupType: DedupType,
): string {
  const hex = makeHash([dedupType, dedupKey].join("\n")).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const normalized = hex.join("");
  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20, 32),
  ].join("-");
}

export function buildSlackEventDedupKey(params: {
  eventId?: string | null;
  channel: string;
  user: string;
  messageTs: string;
  rootThreadTs: string;
  text?: string;
}): string {
  const eventId = String(params.eventId || "").trim();
  if (eventId) {
    return makeHash(["event", eventId].join("\n"));
  }
  return makeHash([
    "message",
    params.channel,
    params.user,
    params.rootThreadTs,
    params.messageTs,
    String(params.text || "").trim(),
  ].join("\n"));
}

export function buildSlackResponseDedupKey(params: {
  channel: string;
  text: string;
}): string {
  return makeHash([params.channel, params.text.trim().slice(0, 200)].join("\n"));
}

export function buildSlackMessageDedupKey(params: {
  channel: string;
  rootThreadTs: string;
  user: string;
  messageTs: string;
}): string {
  return makeHash([params.channel, params.rootThreadTs, params.user, params.messageTs].join("\n"));
}

async function pruneOldRows(): Promise<void> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await sbFetch(`/rest/v1/abra_slack_dedup?created_at=lt.${encodeURIComponent(cutoff)}`, {
    method: "DELETE",
    headers: {
      Prefer: "return=minimal",
    },
  }).catch(() => {});
}

export async function hasRecentSlackDedup(
  dedupKey: string,
  dedupType: DedupType,
  windowMs = 5 * 60 * 1000,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const rows = await sbFetch<Array<{ id: string }>>(
    `/rest/v1/abra_slack_dedup?dedup_key=eq.${dedupKey}&dedup_type=eq.${dedupType}&created_at=gte.${encodeURIComponent(cutoff)}&select=id&limit=1`,
  ).catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

export async function registerSlackDedup(
  dedupKey: string,
  dedupType: DedupType,
): Promise<void> {
  await pruneOldRows();
  await sbFetch("/rest/v1/abra_slack_dedup", {
    method: "POST",
    headers: {
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      id: buildSlackDedupRowId(dedupKey, dedupType),
      dedup_key: dedupKey,
      dedup_type: dedupType,
    }),
  });
}

async function claimSlackDedup(
  dedupKey: string,
  dedupType: DedupType,
): Promise<boolean> {
  try {
    await registerSlackDedup(dedupKey, dedupType);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("(409)") ||
      message.toLowerCase().includes("duplicate key") ||
      message.includes("23505")
    ) {
      return false;
    }
    throw error;
  }
}

export async function shouldProcessSlackEvent(params: {
  eventId?: string | null;
  channel: string;
  user: string;
  messageTs: string;
  rootThreadTs: string;
  text?: string;
}): Promise<boolean> {
  const dedupKey = buildSlackEventDedupKey(params);
  return claimSlackDedup(dedupKey, "event");
}

export async function shouldPostSlackResponse(params: {
  channel: string;
  text: string;
}): Promise<boolean> {
  const dedupKey = buildSlackResponseDedupKey(params);
  return claimSlackDedup(dedupKey, "response");
}

export async function shouldClaimSlackMessageReply(params: {
  channel: string;
  rootThreadTs: string;
  user: string;
  messageTs: string;
}): Promise<boolean> {
  const dedupKey = buildSlackMessageDedupKey(params);
  return claimSlackDedup(dedupKey, "message");
}
