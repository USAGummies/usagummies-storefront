/**
 * Abra Action Executor — processes action directives from LLM responses.
 *
 * Extracted from the monolithic chat route. Handles:
 * - Parsing <action> XML blocks from Claude's reply
 * - Executing read-only actions (email, ledger, etc.) via standard handlers
 * - Queueing write actions for approval via proposeAndMaybeExecute
 * - Building action notices for the response
 */

import {
  parseActionDirectives,
  proposeAndMaybeExecute,
} from "@/lib/ops/abra-actions";
import { queueTask, completeTask, failTask } from "@/lib/ops/abra-task-queue";

const READ_ONLY_ACTIONS = new Set(["read_email", "search_email", "query_ledger", "query_qbo", "calculate_deal"]);

export type ActionExecutionResult = {
  /** Reply text with <action> blocks stripped */
  cleanReply: string;
  /** User-facing notices about queued/executed actions */
  actionNotices: string[];
  /** Data results from read-only actions, for potential follow-up LLM call */
  readOnlyResults: string[];
};

/**
 * Process all action directives found in the LLM reply.
 * Returns the cleaned reply (without <action> blocks), action notices, and read-only data.
 */
/** Wrap a promise with a timeout — rejects with TimeoutError if not resolved in time */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

const PER_ACTION_TIMEOUT_MS = 12_000; // 12s upper bound per action

export async function executeActions(
  reply: string,
  ctx?: { slackChannelId?: string; slackThreadTs?: string; deadlineMs?: number },
): Promise<ActionExecutionResult> {
  const execStart = Date.now();
  const parsedActions = parseActionDirectives(reply);
  // Always use cleanReply (even if empty) — never fall back to the raw reply which
  // still contains <action> blocks. The caller is responsible for providing a fallback
  // message when cleanReply is empty (e.g., if Claude only emitted an action block).
  const cleanReply = parsedActions.cleanReply;
  const actionNotices: string[] = [];
  const readOnlyResults: string[] = [];

  for (const directive of parsedActions.actions.slice(0, 3)) {
    // Check if we're running out of time (leave 2s for response assembly)
    const elapsed = Date.now() - execStart;
    const remainingMs = ctx?.deadlineMs != null ? ctx.deadlineMs - elapsed : undefined;
    if (remainingMs != null && remainingMs <= 2000) {
      console.warn(`[action-executor] Deadline exceeded (elapsed=${elapsed}ms, remaining=${remainingMs}ms), skipping \`${directive.action.action_type}\` and remaining actions`);
      actionNotices.push(`⏱️ Skipped \`${directive.action.action_type}\` due to time constraints — ask me to run it separately.`);
      break;
    }
    try {
      // Auto-inject Slack context into generate_file actions
      if (directive.action.action_type === "generate_file" && ctx) {
        const p = (directive.action.params || directive.action) as Record<string, unknown>;
        if (!p.channel_id && !p.channelId && ctx.slackChannelId) {
          p.channel_id = ctx.slackChannelId;
        }
        if (!p.thread_ts && !p.threadTs && ctx.slackThreadTs) {
          p.thread_ts = ctx.slackThreadTs;
        }
        if (directive.action.params) {
          directive.action.params = p;
        }
      }
      // Force read-only actions to low risk so auto-exec policies match
      if (READ_ONLY_ACTIONS.has(directive.action.action_type)) {
        directive.action.risk_level = "low";
      }
      // generate_file is auto_with_audit tier with riskFloor "low" — Claude often
      // omits risk_level (normalizeActionDirective defaults to "medium"), which blocks
      // Tier 2 auto-exec. Force to "low" so the policy allows immediate execution.
      if (directive.action.action_type === "generate_file") {
        directive.action.risk_level = "low";
      }
      // Dynamic per-action timeout: min(12s, remainingRouteTime - 2s)
      const perActionTimeout = remainingMs != null
        ? Math.min(PER_ACTION_TIMEOUT_MS, Math.max(1000, remainingMs - 2000))
        : PER_ACTION_TIMEOUT_MS;
      // Track this action in the task queue
      const taskId = await queueTask({
        task_type: "action_execution",
        description: directive.action.description || directive.action.title || directive.action.action_type,
        action_type: directive.action.action_type,
        action_params: directive.action.params as Record<string, unknown> | undefined,
        channel_id: ctx?.slackChannelId,
        thread_ts: ctx?.slackThreadTs,
      }).catch(() => null);

      const outcome = await withTimeout(
        proposeAndMaybeExecute(directive.action),
        perActionTimeout,
        directive.action.action_type,
      );

      // Track completion/failure in task queue
      if (taskId) {
        if (outcome.auto_executed && outcome.result?.success) {
          void completeTask(taskId, outcome.result.message || "Completed").catch(() => {});
        } else if (outcome.auto_executed && !outcome.result?.success) {
          void failTask(taskId, outcome.result?.message || "Action failed").catch(() => {});
        } else if (!outcome.auto_executed) {
          void completeTask(taskId, `Queued for approval: ${outcome.approval_id}`).catch(() => {});
        }
      }

      if (outcome.auto_executed) {
        const isReadOnly = READ_ONLY_ACTIONS.has(directive.action.action_type);
        if (isReadOnly && outcome.result?.success && outcome.result.message) {
          // For read-only actions, surface the full result content so the user sees it
          readOnlyResults.push(outcome.result.message);
        } else if (outcome.result && !outcome.result.success) {
          // Action executed but failed — show the error to the user
          console.error(`[action-executor] Action ${directive.action.action_type} failed: ${outcome.result.message}`);
          actionNotices.push(
            `⚠️ \`${directive.action.action_type}\` failed: ${outcome.result.message || "unknown error"}`,
          );
        } else {
          if (isReadOnly) {
            console.warn(`[action-executor] Read-only action ${directive.action.action_type} went to notices: success=${outcome.result?.success}, hasMessage=${!!outcome.result?.message}, message=${outcome.result?.message?.slice(0, 100)}`);
          }
          // For generate_file, use the handler's result message (e.g., upload confirmation with permalink)
          // Tag with [generate_file] so the chat route's fileActionHandled guard can detect it.
          if (directive.action.action_type === "generate_file" && outcome.result?.message) {
            actionNotices.push(`✅ [generate_file] ${outcome.result.message}`);
          } else {
            // For other actions with meaningful result messages, surface the message directly
            const resultMsg = outcome.result?.success && outcome.result.message
              ? outcome.result.message
              : `Done: auto-executed \`${directive.action.action_type}\` (${outcome.approval_id}).`;
            actionNotices.push(resultMsg);
          }
        }
      } else {
        actionNotices.push(
          `Queued for approval: \`${directive.action.action_type}\` (${outcome.approval_id}).`,
        );
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "unknown error";
      const isTimeout = errMsg.includes("Timeout") || errMsg.includes("timeout") || errMsg.includes("exceeded");
      // If timeout but task was queued, report accurately
      if (isTimeout && taskId) {
        void failTask(taskId, `Execution timed out after ${PER_ACTION_TIMEOUT_MS}ms`).catch(() => {});
        actionNotices.push(
          `⏱️ \`${directive.action.action_type}\` timed out but was logged. It may still be processing — check back shortly.`,
        );
      } else {
        if (taskId) void failTask(taskId, errMsg).catch(() => {});
        actionNotices.push(
          `⚠️ \`${directive.action.action_type}\` failed: ${errMsg}`,
        );
      }
    }
  }

  return { cleanReply, actionNotices, readOnlyResults };
}
