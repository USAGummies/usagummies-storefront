import { proactiveMessage } from "@/lib/ops/abra-slack-responder";
import { readState, writeState } from "@/lib/ops/state";

export type BankFeedSweepResult = {
  total: number;
  highConfidence: number;
  lowConfidence: number;
  applied: number;
  investorTransfers: number;
};

type BankFeedSweepPostState = {
  date: string;
  signature: string;
};

const BANK_FEED_SWEEP_POST_STATE_KEY = "operator:bank_feed_sweep:last_posted" as const;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildBankFeedSweepSignature(
  result: BankFeedSweepResult,
  executeErrors: number,
): string {
  return JSON.stringify({
    total: result.total,
    applied: result.applied,
    lowConfidence: result.lowConfidence,
    investorTransfers: result.investorTransfers,
    executeErrors,
  });
}

export function shouldPostBankFeedSweepUpdate(
  previous: BankFeedSweepPostState | null,
  currentDate: string,
  signature: string,
): boolean {
  if (!previous) return true;
  if (previous.date !== currentDate) return true;
  return previous.signature !== signature;
}

function resolveInternalHost(): string {
  return (
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")
  );
}

export async function runBankFeedSweep(): Promise<BankFeedSweepResult> {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    throw new Error("CRON_SECRET not configured");
  }

  const host = resolveInternalHost();

  // Step 1: Preview — find uncategorized transactions via QBO API
  const previewRes = await fetch(
    `${host}/api/ops/qbo/categorize-batch`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "preview" }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  const previewData = (await previewRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!previewRes.ok) {
    throw new Error(
      typeof previewData.error === "string"
        ? previewData.error
        : `Bank feed preview failed (${previewRes.status})`,
    );
  }

  const total = typeof previewData.total === "number" ? previewData.total : 0;
  const autoCategorizeable = typeof previewData.autoCategorizeable === "number" ? previewData.autoCategorizeable : 0;
  const needsReview = typeof previewData.needsReview === "number" ? previewData.needsReview : 0;
  const reneTransfers = typeof previewData.reneTransfers === "number" ? previewData.reneTransfers : 0;

  // If nothing to categorize, return early
  if (total === 0) {
    return {
      total: 0,
      highConfidence: 0,
      lowConfidence: 0,
      applied: 0,
      investorTransfers: 0,
    };
  }

  // Step 2: Execute — auto-categorize high-confidence matches
  let applied = 0;
  let executeErrors = 0;

  if (autoCategorizeable > 0) {
    const execRes = await fetch(
      `${host}/api/ops/qbo/categorize-batch`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cronSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode: "execute" }),
        signal: AbortSignal.timeout(50_000),
      },
    );

    const execData = (await execRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (execRes.ok) {
      applied = typeof execData.categorized === "number" ? execData.categorized : 0;
      executeErrors = typeof execData.errors === "number" ? execData.errors : 0;
    }
  }

  const result: BankFeedSweepResult = {
    total,
    highConfidence: autoCategorizeable,
    lowConfidence: needsReview,
    applied,
    investorTransfers: reneTransfers,
  };

  // Step 3: Post interactive Slack report with batch approval button
  if (result.total > 0) {
    const currentDate = todayIso();
    const signature = buildBankFeedSweepSignature(result, executeErrors);
    const lastPosted = await readState<BankFeedSweepPostState | null>(BANK_FEED_SWEEP_POST_STATE_KEY, null);
    if (!shouldPostBankFeedSweepUpdate(lastPosted, currentDate, signature)) {
      return result;
    }

    const botToken = process.env.SLACK_BOT_TOKEN;
    const channel = process.env.SLACK_CHANNEL_ALERTS || "C0ALS6W7VB4";

    const summaryText = [
      `🏦 *Bank Feed Reconciliation — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}*`,
      "",
      `• *${result.applied}* transactions auto-categorized`,
      result.lowConfidence > 0
        ? `• *${result.lowConfidence}* need manual review`
        : null,
      result.investorTransfers > 0
        ? `• 🔴 *${result.investorTransfers}* investor transfer${result.investorTransfers === 1 ? "" : "s"} from Rene flagged → QBO Account 2300 (Liability)`
        : null,
      executeErrors > 0
        ? `• ⚠️ ${executeErrors} categorization error${executeErrors === 1 ? "" : "s"}`
        : null,
      "",
      result.lowConfidence > 0
        ? `_Rene: tap Approve to accept the batch, or Review to see individual items._`
        : `_All transactions categorized with high confidence._`,
    ].filter(Boolean).join("\n");

    if (botToken && result.lowConfidence > 0) {
      // Post with interactive buttons for batch approval
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel,
          text: summaryText,
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: summaryText },
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: `✅ Approve Batch (${result.applied} items)` },
                  style: "primary",
                  action_id: "approve_batch_categorize",
                  value: JSON.stringify({ applied: result.applied, date: new Date().toISOString() }),
                },
                {
                  type: "button",
                  text: { type: "plain_text", text: "📋 Review Items" },
                  action_id: "review_batch_categorize",
                  value: "review",
                },
                {
                  type: "button",
                  text: { type: "plain_text", text: "❌ Reject" },
                  style: "danger",
                  action_id: "reject_batch_categorize",
                  value: "reject",
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => {});
    } else {
      // Fallback: simple text message
      await proactiveMessage({
        target: "channel",
        channelOrUserId: channel,
        message: summaryText,
        requiresResponse: result.lowConfidence > 0 || result.investorTransfers > 0,
      }).catch(() => {});
    }

    // Also DM Rene if there are items needing review
    if (botToken && (result.lowConfidence > 0 || result.investorTransfers > 0)) {
      const RENE_ID = "U0ALL27JM38";
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: RENE_ID,
          text: `📋 *${result.lowConfidence} QBO transactions need your review*${result.investorTransfers > 0 ? ` + ${result.investorTransfers} investor transfer(s) flagged` : ""}. Check #abra-control for the batch approval.`,
        }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }

    await writeState(BANK_FEED_SWEEP_POST_STATE_KEY, {
      date: currentDate,
      signature,
    });
  }

  return result;
}
