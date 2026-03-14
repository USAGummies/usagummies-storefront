export type ChatMessageRow = {
  id: string;
  user_email: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown> | null;
  model_used: string | null;
  token_count: number | null;
  created_at: string;
};

export type ThreadSummary = {
  thread_id: string;
  last_message_at: string;
  first_message_preview: string;
  message_count: number;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase not configured");

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(12000),
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

export async function saveMessage(params: {
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown>;
  model_used?: string;
  token_count?: number;
  user_email?: string;
}): Promise<void> {
  const content = params.content.trim();
  if (!content) return;

  await sbFetch("/rest/v1/abra_chat_history", {
    method: "POST",
    headers: {
      Prefer: "return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      thread_id: params.thread_id,
      role: params.role,
      content,
      metadata: params.metadata || {},
      model_used: params.model_used || null,
      token_count:
        typeof params.token_count === "number" ? params.token_count : null,
      user_email: params.user_email || "ben@usagummies.com",
    }),
  });
}

export async function getThreadHistory(
  threadId: string,
  limit = 40,
): Promise<ChatMessageRow[]> {
  const rows = (await sbFetch(
    `/rest/v1/abra_chat_history?thread_id=eq.${threadId}&select=id,user_email,thread_id,role,content,metadata,model_used,token_count,created_at&order=created_at.asc&limit=${limit}`,
  )) as ChatMessageRow[];
  return Array.isArray(rows) ? rows : [];
}

export async function getRecentThreads(
  userEmail: string,
  limit = 20,
): Promise<ThreadSummary[]> {
  const rows = (await sbFetch(
    `/rest/v1/abra_chat_history?user_email=eq.${encodeURIComponent(userEmail)}&select=thread_id,content,created_at&order=created_at.desc&limit=300`,
  )) as Array<{
    thread_id?: string;
    content?: string;
    created_at?: string;
  }>;

  const map = new Map<string, ThreadSummary>();
  for (const row of rows || []) {
    const threadId = row.thread_id || "";
    if (!threadId) continue;
    const createdAt = row.created_at || new Date().toISOString();
    if (!map.has(threadId)) {
      map.set(threadId, {
        thread_id: threadId,
        last_message_at: createdAt,
        first_message_preview: (row.content || "").slice(0, 120),
        message_count: 1,
      });
      continue;
    }
    const existing = map.get(threadId)!;
    existing.message_count += 1;
  }

  return Array.from(map.values())
    .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at))
    .slice(0, limit);
}

export async function buildConversationContext(
  threadId: string,
  maxMessages = 12,
): Promise<Array<{ role: "user" | "assistant" | "system"; content: string }>> {
  const history = await getThreadHistory(threadId, Math.max(maxMessages * 2, 30));
  return history
    .slice(-maxMessages)
    .map((row) => {
      const role: "user" | "assistant" | "system" =
        row.role === "assistant" || row.role === "system"
          ? row.role
          : "user";
      return {
        role,
        content: row.content || "",
      };
    })
    .filter((row) => row.content.trim().length > 0);
}
