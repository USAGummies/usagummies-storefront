import { proactiveMessage } from "@/lib/ops/abra-slack-responder";

export type BankFeedSweepResult = {
  total: number;
  highConfidence: number;
  lowConfidence: number;
  applied: number;
  investorTransfers: number;
};

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

  // Step 3: Post to Slack if there's anything to report
  if (result.total > 0) {
    const lines = [
      `🏦 *Bank feed sweep complete*`,
      `• ${result.applied} auto-categorized${executeErrors > 0 ? ` (${executeErrors} errors)` : ""}`,
      result.lowConfidence > 0
        ? `• ${result.lowConfidence} need manual review`
        : null,
      result.investorTransfers > 0
        ? `🔴 ${result.investorTransfers} investor transfer${result.investorTransfers === 1 ? "" : "s"} from Rene flagged`
        : null,
    ].filter(Boolean);

    await proactiveMessage({
      target: "channel",
      channelOrUserId: process.env.SLACK_CHANNEL_ALERTS || "C0ALS6W7VB4",
      message: lines.join("\n"),
      requiresResponse: result.lowConfidence > 0 || result.investorTransfers > 0,
    }).catch(() => {});
  }

  return result;
}
