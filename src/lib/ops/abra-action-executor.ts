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
export async function executeActions(reply: string): Promise<ActionExecutionResult> {
  const parsedActions = parseActionDirectives(reply);
  const cleanReply = parsedActions.cleanReply || reply;
  const actionNotices: string[] = [];
  const readOnlyResults: string[] = [];

  for (const directive of parsedActions.actions.slice(0, 3)) {
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
      // Force read-only actions to low risk so auto-exec policies match
      if (READ_ONLY_ACTIONS.has(directive.action.action_type)) {
        directive.action.risk_level = "low";
      }
      const outcome = await proposeAndMaybeExecute(directive.action);
      if (outcome.auto_executed) {
        const isReadOnly = READ_ONLY_ACTIONS.has(directive.action.action_type);
        if (isReadOnly && outcome.result?.success && outcome.result.message) {
          // For read-only actions, surface the full result content so the user sees it
          readOnlyResults.push(outcome.result.message);
        } else {
          if (isReadOnly) {
            console.warn(`[action-executor] Read-only action ${directive.action.action_type} went to notices: success=${outcome.result?.success}, hasMessage=${!!outcome.result?.message}, message=${outcome.result?.message?.slice(0, 100)}`);
          }
          actionNotices.push(
            `Done: auto-executed \`${directive.action.action_type}\` (${outcome.approval_id}).`,
          );
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
