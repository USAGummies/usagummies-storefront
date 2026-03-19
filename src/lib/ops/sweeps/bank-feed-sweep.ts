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

  const res = await fetch(
    `${resolveInternalHost()}/api/ops/abra/categorize-transactions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ apply: true }),
      signal: AbortSignal.timeout(55_000),
    },
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : `Categorization sweep failed (${res.status})`,
    );
  }

  const results = Array.isArray(data.results)
    ? data.results as Array<Record<string, unknown>>
    : [];
  const investorTransfers = results.filter((row) =>
    /rene/i.test(String(row.description || "")) ||
    /investor/i.test(String(row.category || "")),
  ).length;

  const result: BankFeedSweepResult = {
    total: typeof data.total === "number" ? data.total : results.length,
    highConfidence:
      typeof data.highConfidence === "number" ? data.highConfidence : 0,
    lowConfidence:
      typeof data.lowConfidence === "number" ? data.lowConfidence : 0,
    applied: typeof data.applied === "number" ? data.applied : 0,
    investorTransfers,
  };

  if (result.total > 0) {
    const lines = [
      `🏦 Bank feed sweep: ${result.applied} auto-categorized, ${result.lowConfidence} need review`,
      result.investorTransfers > 0
        ? `🔴 ${result.investorTransfers} investor transfer${result.investorTransfers === 1 ? "" : "s"} flagged`
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
