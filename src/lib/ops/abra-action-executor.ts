/**
 * Abra Action Executor — processes action directives from LLM responses.
 *
 * Extracted from the monolithic chat route. Handles:
 * - Parsing <action> XML blocks from Claude's reply
 * - Executing read-only actions (email, ledger, deal calculator) inline
 * - Queueing write actions for approval via proposeAndMaybeExecute
 * - Building action notices for the response
 */

import {
  parseActionDirectives,
  proposeAndMaybeExecute,
} from "@/lib/ops/abra-actions";
import { calculateDeal, type ChannelType } from "@/lib/ops/abra-skill-deal-calculator";

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
  const cleanReply = parsedActions.cleanReply || reply;
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
      // Handle calculate_deal inline — pure computation, no side effects
      if (directive.action.action_type === "calculate_deal") {
        const p = (directive.action.params || directive.action) as Record<string, unknown>;
        const channelMap: Record<string, ChannelType> = {
          dtc: "dtc", shopify: "dtc", amazon: "amazon", fba: "amazon",
          wholesale: "wholesale_direct", wholesale_direct: "wholesale_direct",
          faire: "faire", broker: "wholesale_broker", wholesale_broker: "wholesale_broker",
        };
        const ch = channelMap[String(p.channel || "wholesale_direct").toLowerCase()] || "wholesale_direct";
        const result = calculateDeal({
          customerName: String(p.customer || p.customerName || "Unknown"),
          channel: ch,
          units: Number(p.units) || 100,
          pricePerUnit: p.price_per_unit != null ? Number(p.price_per_unit) : undefined,
        });
        readOnlyResults.push(
          `## Deal Calculator Result\n` +
          `**Customer:** ${result.customerName} | **Channel:** ${result.channel}\n` +
          `**Units:** ${result.units} @ $${result.pricePerUnit}/unit\n\n` +
          `| Metric | Value |\n|--------|-------|\n` +
          `| Gross Revenue | $${result.grossRevenue.toFixed(2)} |\n` +
          `| Channel Fees | $${result.channelFees.toFixed(2)} |\n` +
          `| Net Revenue | $${result.netRevenue.toFixed(2)} |\n` +
          `| Total COGS | $${result.totalCogs.toFixed(2)} |\n` +
          `| **Gross Profit** | **$${result.grossProfit.toFixed(2)}** |\n` +
          `| **Margin** | **${result.grossMarginPct.toFixed(1)}%** |\n` +
          `| Profit/Unit | $${result.contributionPerUnit.toFixed(2)} |\n\n` +
          `**Recommendation:** ${result.recommendation}\n\n` +
          `**Channel Comparison:**\n` +
          result.comparison.map(c => `- ${c.channel}: ${c.marginPct.toFixed(1)}% margin, $${c.profitPerUnit.toFixed(2)}/unit`).join("\n")
        );
        continue;
      }
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
      // Dynamic per-action timeout: min(12s, remainingRouteTime - 2s)
      const perActionTimeout = remainingMs != null
        ? Math.min(PER_ACTION_TIMEOUT_MS, Math.max(1000, remainingMs - 2000))
        : PER_ACTION_TIMEOUT_MS;
      const outcome = await withTimeout(
        proposeAndMaybeExecute(directive.action),
        perActionTimeout,
        directive.action.action_type,
      );
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
          // For file uploads and other actions with meaningful result messages, surface the message
          const resultMsg = outcome.result?.success && outcome.result.message
            ? outcome.result.message
            : `Done: auto-executed \`${directive.action.action_type}\` (${outcome.approval_id}).`;
          actionNotices.push(resultMsg);
        }
      } else {
        actionNotices.push(
          `Queued for approval: \`${directive.action.action_type}\` (${outcome.approval_id}).`,
        );
      }
    } catch (error) {
      actionNotices.push(
        `Failed to queue action \`${directive.action.action_type}\`: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  return { cleanReply, actionNotices, readOnlyResults };
}
