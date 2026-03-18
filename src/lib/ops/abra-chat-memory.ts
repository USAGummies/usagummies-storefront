/**
 * Abra Chat Memory — persistent conversation context across Slack interactions.
 *
 * Stores per-user message history in KV state so Abra can reference previous
 * conversations even across different Slack threads. Complements the in-thread
 * history that fetchThreadHistory() already provides — this module gives
 * cross-thread, long-term memory.
 *
 * Storage: Single KV key `abra-chat-histories` holding { [userId]: messages[] }
 * Retention: Last 50 messages per user, trimmed to 500 chars each.
 */

import { readState, writeState } from "@/lib/ops/state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatMemoryMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  slackUserId?: string;
  slackChannelId?: string;
  slackThreadTs?: string;
};

export type ConversationContext = {
  recentMessages: ChatMemoryMessage[];
  topicSummary: string;
  lastInteraction: string; // ISO timestamp
};

type ChatHistoryStore = Record<string, ChatMemoryMessage[]>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MESSAGES_PER_USER = 50;
const MAX_MESSAGE_LENGTH = 500;
const DEFAULT_RECENT_LIMIT = 10;
const STATE_KEY = "abra-chat-histories" as const;

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Record a message (user or assistant) in the per-user chat history.
 * Trims message content to MAX_MESSAGE_LENGTH and prunes history to
 * MAX_MESSAGES_PER_USER entries.
 */
export async function recordMessage(msg: ChatMemoryMessage): Promise<void> {
  const userId = msg.slackUserId;
  if (!userId) return; // Can't store without a user ID

  const store = await readState<ChatHistoryStore>(STATE_KEY, {});
  const history = store[userId] || [];

  const trimmed: ChatMemoryMessage = {
    ...msg,
    content: msg.content.slice(0, MAX_MESSAGE_LENGTH),
  };

  history.push(trimmed);

  // Prune to keep only the most recent messages
  store[userId] = history.slice(-MAX_MESSAGES_PER_USER);

  await writeState(STATE_KEY, store);
}

/**
 * Get the last N messages for a user (default 10).
 */
export async function getRecentContext(
  userId: string,
  n: number = DEFAULT_RECENT_LIMIT,
): Promise<ChatMemoryMessage[]> {
  const store = await readState<ChatHistoryStore>(STATE_KEY, {});
  const history = store[userId] || [];
  return history.slice(-n);
}

/**
 * Get full conversation context: recent messages + auto-generated topic summary.
 */
export async function getConversationContext(
  userId: string,
  limit: number = DEFAULT_RECENT_LIMIT,
): Promise<ConversationContext> {
  const messages = await getRecentContext(userId, limit);

  const lastInteraction =
    messages.length > 0
      ? messages[messages.length - 1].timestamp
      : new Date(0).toISOString();

  const topicSummary = summarizeRecentTopics(messages);

  return {
    recentMessages: messages,
    topicSummary,
    lastInteraction,
  };
}

/**
 * Extract key topics from recent messages via simple keyword/entity extraction.
 * Not LLM-based — uses frequency counting and pattern matching.
 */
export function summarizeRecentTopics(messages: ChatMemoryMessage[]): string {
  if (messages.length === 0) return "";

  const userMessages = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content);

  if (userMessages.length === 0) return "";

  const allText = userMessages.join(" ").toLowerCase();

  // Common stop words to exclude
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further", "then",
    "once", "here", "there", "when", "where", "why", "how", "all", "each",
    "every", "both", "few", "more", "most", "other", "some", "such", "no",
    "not", "only", "own", "same", "so", "than", "too", "very", "just",
    "don", "now", "and", "but", "or", "if", "while", "about", "up",
    "what", "which", "who", "whom", "this", "that", "these", "those",
    "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
    "she", "her", "it", "its", "they", "them", "their", "am", "much",
    "many", "also", "get", "got", "like", "make", "know", "think",
    "tell", "say", "said", "let", "us", "please", "thanks", "thank",
    "hey", "hi", "hello", "abra", "okay", "ok",
  ]);

  // Extract words, count frequencies
  const words = allText
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  const freq: Record<string, number> = {};
  for (const word of words) {
    freq[word] = (freq[word] || 0) + 1;
  }

  // Extract multi-word phrases (bigrams) that appear more than once
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    if (!stopWords.has(words[i]) && !stopWords.has(words[i + 1])) {
      freq[bigram] = (freq[bigram] || 0) + 1;
    }
  }

  // Sort by frequency, take top terms
  const topTerms = Object.entries(freq)
    .filter(([, count]) => count >= 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([term]) => term);

  if (topTerms.length === 0) return "";

  return `Recent topics: ${topTerms.join(", ")}`;
}

/**
 * Clear all chat history for a user (the "forget" command).
 */
export async function clearHistory(userId: string): Promise<void> {
  const store = await readState<ChatHistoryStore>(STATE_KEY, {});
  delete store[userId];
  await writeState(STATE_KEY, store);
}

/**
 * Format recent messages as a string block suitable for injection into
 * an LLM system prompt.
 */
export function formatMemoryForPrompt(messages: ChatMemoryMessage[]): string {
  if (messages.length === 0) return "";

  const lines = messages.map((m) => {
    const timeAgo = getRelativeTime(m.timestamp);
    const role = m.role === "user" ? "User" : "Abra";
    return `[${timeAgo}] ${role}: ${m.content}`;
  });

  return (
    "PREVIOUS CONVERSATION MEMORY (cross-thread, from past interactions with this user):\n" +
    lines.join("\n")
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRelativeTime(isoTimestamp: string): string {
  const now = Date.now();
  const then = new Date(isoTimestamp).getTime();
  const diffMs = now - then;

  if (isNaN(then) || diffMs < 0) return "just now";

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;

  return `${Math.floor(days / 7)}w ago`;
}
