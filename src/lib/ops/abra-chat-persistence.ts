/**
 * Abra Chat Persistence — handles saving chat history, conversation
 * summarization, provenance logging, and unanswered question tracking.
 *
 * Extracted from the monolithic chat route to isolate all post-response
 * side-effect logic (memory writes, pattern learning, etc.).
 */

import { after } from "next/server";
import { kv } from "@vercel/kv";
import {
  buildConversationContext,
  getThreadHistory as getStoredThreadHistory,
  saveMessage,
} from "@/lib/ops/abra-chat-history";
import {
  summarizeConversation,
  storeConversationSummary,
} from "@/lib/ops/memory/conversation-summarizer";
import { learnDecisionPatterns } from "@/lib/ops/memory/decision-patterns";
import { captureOperationalPatterns } from "@/lib/ops/memory/operational-patterns";
import { notifyAlert } from "@/lib/ops/notify";
import { logAnswer, extractProvenance } from "@/lib/ops/abra-source-provenance";
import { detectQuestions, shouldAskQuestions } from "@/lib/ops/abra-question-detector";
import type { TieredSearchRow } from "@/lib/ops/abra-memory-tiers";
import { sbFetch } from "@/lib/ops/abra-context-builder";

// ─── Utility ───

export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function makeThreadId(): string {
  return crypto.randomUUID();
}

// Re-export for route convenience
export { buildConversationContext };

// ─── Chat History Queue ───

export function queueChatHistory(params: {
  threadId: string;
  userEmail: string;
  userMessage: string;
  assistantMessage: string;
  modelUsed?: string;
  metadata?: Record<string, unknown>;
  actorLabel?: string;
}) {
  if (!isUuidLike(params.threadId)) return;
  after(async () => {
    try {
      await saveMessage({
        thread_id: params.threadId,
        role: "user",
        content: params.userMessage,
        user_email: params.userEmail,
      });

      await saveMessage({
        thread_id: params.threadId,
        role: "assistant",
        content: params.assistantMessage,
        model_used: params.modelUsed,
        metadata: params.metadata || {},
        user_email: params.userEmail,
      });

      const history = await getStoredThreadHistory(params.threadId, 24);
      if (history.length < 4) return;

      const summaryCountKey = `abra:memory:summary-count:${params.threadId}`;
      const messageCount = history.length;
      try {
        const lastCount = await kv.get<number>(summaryCountKey);
        if (typeof lastCount === "number" && lastCount >= messageCount) return;
      } catch (err) {
        console.error("[abra/chat] KV dedupe read failed — continuing without deduplication", err);
      }

      const summary = await summarizeConversation(
        history.map((row) => ({
          role: row.role,
          content: row.content,
          timestamp: row.created_at,
        })),
        [params.actorLabel || params.userEmail, "Abra"],
        { sourceRef: `conversation-thread:${params.threadId}` },
      );
      await storeConversationSummary(summary);
      try {
        await kv.set(summaryCountKey, messageCount, { ex: 7 * 24 * 60 * 60 });
      } catch (err) {
        console.error("[abra/chat] KV dedupe write failed — summary count not persisted", err);
      }
    } catch (err) {
      // Summarization failures are non-critical — log but don't Slack-alert.
      // These happen when Claude returns malformed JSON or the LLM is overloaded.
      // The conversation is still saved; only the summary is lost.
      console.error("[abra/chat] Conversation summarization failed (non-critical):", err instanceof Error ? err.message : String(err));
    }

    void learnDecisionPatterns().catch((err) =>
      console.error("[abra/chat] learnDecisionPatterns failed", err),
    );
    void captureOperationalPatterns().catch((err) =>
      console.error("[abra/chat] captureOperationalPatterns failed", err),
    );
  });
}

// ─── Provenance & Unanswered Questions ───

export function logProvenance(params: {
  message: string;
  reply: string;
  sources: TieredSearchRow[];
  confidence: number;
  department: string | null;
  actorEmail: string;
  channel: "web" | "slack" | "api";
  modelUsed: string;
}) {
  const provenance = extractProvenance(params.sources);
  void logAnswer({
    question: params.message,
    answer: params.reply,
    source_ids: provenance.source_ids,
    source_tables: provenance.source_tables,
    confidence: params.confidence,
    memory_tiers_used: provenance.memory_tiers_used,
    department: params.department,
    asked_by: params.actorEmail,
    channel: params.channel,
    model_used: params.modelUsed,
  });
}

export async function logUnansweredQuestions(params: {
  reply: string;
  confidence: number;
  sources: TieredSearchRow[];
  message: string;
  actorEmail: string;
}) {
  const detectedQuestions = detectQuestions(params.reply);
  if (
    detectedQuestions.length > 0 ||
    shouldAskQuestions(params.confidence, params.sources)
  ) {
    for (const q of detectedQuestions.slice(0, 3)) {
      await logUnansweredQuestion(
        q,
        params.actorEmail,
        `Original question: ${params.message}`,
      );
    }
  }
}

async function logUnansweredQuestion(
  question: string,
  askedBy: string,
  context: string,
) {
  try {
    await sbFetch("/rest/v1/abra_unanswered_questions", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question,
        asked_by: askedBy,
        context: context.slice(0, 500),
      }),
    });
  } catch {
    // Best-effort
  }
}
