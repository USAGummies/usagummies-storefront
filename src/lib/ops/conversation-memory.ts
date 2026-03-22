/**
 * Cross-Session Conversation Memory
 *
 * Auto-summarizes conversations (>3 exchanges) into brain entries.
 * Tags with entities discussed, decisions made, and open items.
 * Next session, semantic search pulls relevant prior conversations.
 */

export type ConversationSummary = {
  threadId: string;
  actor: string;
  messageCount: number;
  topics: string[];
  decisions: string[];
  openItems: string[];
  summary: string;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

/**
 * Extract key topics from conversation messages.
 */
function extractTopics(messages: Array<{ role: string; content: string }>): string[] {
  const topicPatterns: Array<{ pattern: RegExp; topic: string }> = [
    { pattern: /revenue|sales|orders|aov/i, topic: "revenue" },
    { pattern: /cogs|margin|profit|cost/i, topic: "unit_economics" },
    { pattern: /powers|albanese|belmark|vendor/i, topic: "vendors" },
    { pattern: /production|inventory|reorder|units/i, topic: "supply_chain" },
    { pattern: /qbo|quickbooks|categorize|reconcil/i, topic: "bookkeeping" },
    { pattern: /investor|rene.*wire|capital|funding/i, topic: "finance" },
    { pattern: /amazon|shopify|channel/i, topic: "channels" },
    { pattern: /inderbitzin|wholesale|b2b|pipeline/i, topic: "sales" },
    { pattern: /teach|correct|update/i, topic: "knowledge_update" },
  ];

  const allText = messages.map(m => m.content).join(" ");
  const topics: string[] = [];
  for (const { pattern, topic } of topicPatterns) {
    if (pattern.test(allText) && !topics.includes(topic)) {
      topics.push(topic);
    }
  }
  return topics;
}

/**
 * Build a compact summary of a conversation for brain storage.
 */
function buildSummary(
  messages: Array<{ role: string; content: string }>,
  actor: string,
): ConversationSummary {
  const userMessages = messages.filter(m => m.role === "user");
  const assistantMessages = messages.filter(m => m.role === "assistant");
  const topics = extractTopics(messages);

  // Extract decisions (look for definitive statements in assistant messages)
  const decisions: string[] = [];
  const openItems: string[] = [];

  for (const msg of assistantMessages) {
    const text = msg.content;
    // Decisions: corrections, confirmations, recorded facts
    if (/(?:logged|recorded|confirmed|updated|corrected)/i.test(text)) {
      const snippet = text.slice(0, 100).replace(/\n/g, " ");
      decisions.push(snippet);
    }
    // Open items: things flagged for follow-up
    if (/(?:flag|follow.up|need to|should|open item|pending)/i.test(text)) {
      const match = text.match(/(?:flag|follow.up|need to|should)[^.]*\./i);
      if (match) openItems.push(match[0].slice(0, 100));
    }
  }

  // Compact summary from user questions
  const questionSummary = userMessages
    .slice(0, 5)
    .map(m => m.content.slice(0, 80))
    .join(" → ");

  return {
    threadId: "",
    actor,
    messageCount: messages.length,
    topics,
    decisions: decisions.slice(0, 5),
    openItems: openItems.slice(0, 3),
    summary: `${actor} asked: ${questionSummary}. Topics: ${topics.join(", ")}.${decisions.length > 0 ? ` Decisions: ${decisions.length}.` : ""}${openItems.length > 0 ? ` Open items: ${openItems.length}.` : ""}`,
  };
}

/**
 * Store a conversation summary in the brain (best-effort).
 */
export async function summarizeAndStore(
  threadId: string,
  messages: Array<{ role: string; content: string }>,
  actor: string,
): Promise<boolean> {
  // Only summarize conversations with 3+ exchanges
  if (messages.length < 6) return false; // 3 user + 3 assistant

  const env = getSupabaseEnv();
  if (!env) return false;

  const summary = buildSummary(messages, actor);
  summary.threadId = threadId;

  try {
    await fetch(`${env.baseUrl}/rest/v1/open_brain_entries`, {
      method: "POST",
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        source_type: "automated",
        source_ref: `conversation-${threadId}`,
        entry_type: "conversation_summary",
        title: `Conversation: ${actor} — ${summary.topics.slice(0, 3).join(", ") || "general"}`,
        raw_text: JSON.stringify(summary),
        summary_text: summary.summary.slice(0, 500),
        category: "conversation",
        department: "executive",
        tags: [
          `thread:${threadId}`,
          `actor:${actor.toLowerCase().replace(/\s+/g, "_")}`,
          ...summary.topics.map(t => `topic:${t}`),
        ],
        confidence: "medium",
        priority: "normal",
        processed: true,
      }),
      signal: AbortSignal.timeout(5000),
    });
    return true;
  } catch {
    return false;
  }
}
