import { detectDepartment } from "@/lib/ops/department-playbooks";
import { generateEmbedding } from "@/lib/ops/abra-embeddings";
import { extractClaudeUsage, logAICost } from "@/lib/ops/abra-cost-tracker";
import {
  findOrCreateEntity,
  updateEntityMemory,
  type EntityType,
  type Fact,
} from "@/lib/ops/memory/entity-memory";

export type ConversationMessage = {
  role: string;
  content: string;
  timestamp: string;
};

export type ConversationSummary = {
  participants: string[];
  topic: string;
  key_facts: string[];
  decisions_made: string[];
  action_items: string[];
  sentiment: string;
  follow_up_needed: boolean;
  department: string;
  entity_mentions: Array<{ name: string; type: EntityType }>;
  source_ref: string;
  summary_text: string;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Supabase not configured");
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 300)}`,
    );
  }

  return json;
}

function normalizeMessages(messages: ConversationMessage[]): ConversationMessage[] {
  return messages
    .filter((message) => typeof message.content === "string" && message.content.trim().length > 0)
    .slice(-20)
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content.trim().slice(0, 4000),
      timestamp: message.timestamp || new Date().toISOString(),
    }));
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function inferDepartment(messages: ConversationMessage[]): string {
  const joined = messages.map((message) => message.content).join("\n");
  return detectDepartment(joined) || "executive";
}

function categoryForDepartment(department: string): string {
  const normalized = department.toLowerCase();
  if (/\b(finance|accounting)\b/.test(normalized)) return "financial";
  if (/\b(sales|growth|marketing|ecommerce|amazon|trade)\b/.test(normalized)) return "sales";
  if (/\b(supply|operations|retail|production|research)\b/.test(normalized)) return "operational";
  if (/\b(founder|executive|legal|people|corporate)\b/.test(normalized)) return "founder";
  if (/\b(customer)\b/.test(normalized)) return "customer_insight";
  if (/\b(data|it)\b/.test(normalized)) return "general";
  return "general";
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function buildSourceRef(participants: string[], messages: ConversationMessage[]): string {
  const firstTs = messages[0]?.timestamp || new Date().toISOString();
  const dateKey = firstTs.slice(0, 16).replace(/[:T]/g, "-");
  const people = participants.map(slugify).filter(Boolean);
  return `conversation:${people.join("-") || "thread"}:${dateKey}`;
}

function buildSummaryPrompt(messages: ConversationMessage[], participants: string[]): string {
  const transcript = messages
    .map((message) => `[${message.timestamp}] ${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");

  return [
    "Summarize this business conversation as strict JSON.",
    "Return only JSON with keys: topic, key_facts, decisions_made, action_items, sentiment, follow_up_needed, entity_mentions, summary_text.",
    'entity_mentions must be an array of objects like {"name":"Rene Gonzalez","type":"person"}. Allowed types: person, company, account.',
    "Keep arrays concise. Limit key_facts to 6 and action_items to 5.",
    `Known participants: ${participants.join(", ") || "unknown"}`,
    "Transcript:",
    transcript,
  ].join("\n\n");
}

export async function summarizeConversation(
  messages: Array<{ role: string; content: string; timestamp: string }>,
  participants: string[],
  options?: { sourceRef?: string },
): Promise<ConversationSummary> {
  const normalized = normalizeMessages(messages);
  if (normalized.length === 0) {
    throw new Error("No conversation messages to summarize");
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const prompt = buildSummaryPrompt(normalized, participants);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MEMORY_MODEL || "claude-sonnet-4-6",
      max_tokens: 300,
      temperature: 0.1,
      system: "You are a structured conversation summarizer for a business operating system. Return only valid JSON.",
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    content?: Array<{ text?: string }>;
    usage?: unknown;
    model?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(payload.error?.message || `Conversation summarizer failed (${res.status})`);
  }

  const text = payload.content?.map((part) => part.text || "").join("\n") || "";
  const rawJson = extractJsonObject(text);
  if (!rawJson) {
    throw new Error("Conversation summarizer returned invalid JSON");
  }

  const parsed = JSON.parse(rawJson) as {
    topic?: string;
    key_facts?: string[];
    decisions_made?: string[];
    action_items?: string[];
    sentiment?: string;
    follow_up_needed?: boolean;
    entity_mentions?: Array<{ name?: string; type?: string }>;
    summary_text?: string;
  };

  void logAICost({
    model: payload.model || process.env.ANTHROPIC_MEMORY_MODEL || "claude-sonnet-4-6",
    provider: "anthropic",
    endpoint: "memory/conversation-summarizer",
    department: inferDepartment(normalized),
    ...(extractClaudeUsage({ usage: payload.usage }) || {
      inputTokens: Math.max(1, Math.round(prompt.length / 4)),
      outputTokens: Math.max(1, Math.round(text.length / 4)),
    }),
  });

  return {
    participants: participants.filter(Boolean),
    topic: String(parsed.topic || "Business conversation").slice(0, 160),
    key_facts: Array.isArray(parsed.key_facts) ? parsed.key_facts.filter(Boolean).slice(0, 6) : [],
    decisions_made: Array.isArray(parsed.decisions_made) ? parsed.decisions_made.filter(Boolean).slice(0, 5) : [],
    action_items: Array.isArray(parsed.action_items) ? parsed.action_items.filter(Boolean).slice(0, 5) : [],
    sentiment: String(parsed.sentiment || "neutral").slice(0, 80),
    follow_up_needed: Boolean(parsed.follow_up_needed),
    department: inferDepartment(normalized),
    entity_mentions: Array.isArray(parsed.entity_mentions)
      ? parsed.entity_mentions
          .map((entity): { name: string; type: EntityType } => ({
            name: String(entity.name || "").trim(),
            type: entity.type === "company" || entity.type === "account" ? entity.type : "person",
          }))
          .filter((entity) => entity.name.length > 0)
          .slice(0, 8)
      : [],
    source_ref: options?.sourceRef || buildSourceRef(participants, normalized),
    summary_text: String(parsed.summary_text || parsed.topic || "Business conversation summary").slice(0, 500),
  };
}

function renderSummary(summary: ConversationSummary): string {
  const lines = [
    `Topic: ${summary.topic}`,
    `Participants: ${summary.participants.join(", ") || "Unknown"}`,
    `Department: ${summary.department}`,
    `Sentiment: ${summary.sentiment}`,
    `Follow-up needed: ${summary.follow_up_needed ? "yes" : "no"}`,
    "",
    "Key facts:",
    ...(summary.key_facts.length > 0 ? summary.key_facts.map((fact) => `- ${fact}`) : ["- None captured"]),
    "",
    "Decisions:",
    ...(summary.decisions_made.length > 0 ? summary.decisions_made.map((fact) => `- ${fact}`) : ["- None captured"]),
    "",
    "Action items:",
    ...(summary.action_items.length > 0 ? summary.action_items.map((fact) => `- ${fact}`) : ["- None captured"]),
  ];
  return lines.join("\n");
}

async function updateEntitiesFromSummary(summary: ConversationSummary): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const factSeed: Fact[] = [
    ...summary.key_facts.map((fact) => ({ fact, confidence: 0.9, source: "conversation", date: today })),
    ...summary.decisions_made.map((fact) => ({ fact, confidence: 0.95, source: "conversation", date: today })),
  ];

  for (const entity of summary.entity_mentions) {
    try {
      const record = await findOrCreateEntity(entity.name, entity.type);
      await updateEntityMemory(record.entity_id, factSeed, {
        lastInteraction: new Date().toISOString(),
        interactionIncrement: 1,
        openItems: summary.action_items,
        communicationPreferences:
          entity.type === "person"
            ? `${summary.participants.join(", ")} conversation participant`
            : undefined,
      });
    } catch {
      // Entity updates are best-effort and should not block summary storage.
    }
  }
}

export async function storeConversationSummary(summary: ConversationSummary): Promise<void> {
  const rawText = renderSummary(summary);
  const embedding = await generateEmbedding(`${summary.topic}\n${rawText}`);
  const tags = [
    "conversation_summary",
    summary.department,
    ...summary.participants.map(slugify).filter(Boolean),
  ].slice(0, 12);

  const existing = (await sbFetch(
    `/rest/v1/open_brain_entries?source_ref=eq.${encodeURIComponent(summary.source_ref)}&select=id&limit=1`,
  )) as Array<{ id: string }>;

  const payload = {
    title: `Conversation Summary — ${summary.topic}`,
    raw_text: rawText,
    summary_text: summary.summary_text,
    category: categoryForDepartment(summary.department),
    department: summary.department,
    entry_type: "session_summary",
    tags,
    embedding,
  };

  if (existing[0]?.id) {
    await sbFetch(`/rest/v1/open_brain_entries?id=eq.${existing[0].id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } else {
    await sbFetch("/rest/v1/open_brain_entries", {
      method: "POST",
      headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
      body: JSON.stringify({
        source_type: "agent",
        source_ref: summary.source_ref,
        confidence: "high",
        priority: summary.action_items.length + summary.decisions_made.length >= 3 ? "important" : "normal",
        processed: true,
        ...payload,
      }),
    });
  }

  await updateEntitiesFromSummary(summary);
}
