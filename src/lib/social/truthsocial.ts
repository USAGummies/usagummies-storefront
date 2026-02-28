import "server-only";

const BASE = "https://truthsocial.com/api/v1";

function token(): string {
  return (process.env.TRUTHSOCIAL_ACCESS_TOKEN || "").trim();
}

function accountId(): string {
  return (process.env.TRUTHSOCIAL_ACCOUNT_ID || "").trim();
}

export function isTruthSocialConfigured(): boolean {
  return !!(token() && accountId());
}

async function truthRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const t = token();
  if (!t) throw new Error("Truth Social token not configured");

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Truth Social API ${method} ${path} failed (${res.status}): ${text.slice(0, 220)}`);
  }

  return (await res.json()) as T;
}

export async function postStatus(text: string, mediaIds?: string[]) {
  return truthRequest<{ id?: string; content?: string }>("POST", "/statuses", {
    status: text,
    ...(mediaIds && mediaIds.length ? { media_ids: mediaIds } : {}),
  });
}

export async function replyToStatus(statusId: string, text: string) {
  return truthRequest<{ id?: string }>("POST", "/statuses", {
    status: text,
    in_reply_to_id: statusId,
  });
}

export async function getNotifications(sinceId?: string) {
  const params = new URLSearchParams({ limit: "40" });
  if (sinceId) params.set("since_id", sinceId);
  return truthRequest<Array<Record<string, unknown>>>("GET", `/notifications?${params.toString()}`);
}

export async function getTimeline(limit = 20) {
  const aid = accountId();
  if (!aid) return [] as Array<Record<string, unknown>>;
  return truthRequest<Array<Record<string, unknown>>>("GET", `/accounts/${aid}/statuses?limit=${Math.max(1, Math.min(40, limit))}`);
}

export async function uploadMedia(_imageUrl: string): Promise<{ id: string } | null> {
  // Multipart media upload not implemented in this pass.
  return null;
}
