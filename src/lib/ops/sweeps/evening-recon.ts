import {
  buildReconciliationPeriod,
  generateReconciliationReport,
} from "@/lib/ops/revenue-reconciliation";
import { proactiveMessage } from "@/lib/ops/abra-slack-responder";

export type EveningReconResult = {
  status: "clean" | "needs_review" | "discrepancies_found";
  issuesFound: number;
  totalVariance: number;
  periodLabel: string;
};

export async function runEveningRecon(): Promise<EveningReconResult> {
  const period = buildReconciliationPeriod();
  const report = await generateReconciliationReport(period);
  const issues = report.channels.filter((channel) => channel.status !== "matched");

  if (issues.length > 0 || report.status !== "clean") {
    const lines = [
      `🌙 Evening reconciliation: ${report.status.replace(/_/g, " ")}`,
      `Period: ${report.period.label}`,
      `Total variance: $${report.totalVariance.toFixed(2)}`,
      ...issues.slice(0, 4).map(
        (channel) =>
          `• ${channel.channel}: ${channel.status.replace(/_/g, " ")} (${channel.variance >= 0 ? "+" : ""}$${channel.variance.toFixed(2)})`,
      ),
    ];
    await proactiveMessage({
      target: "channel",
      channelOrUserId: process.env.SLACK_CHANNEL_ALERTS || "C0ALS6W7VB4",
      message: lines.join("\n"),
    }).catch(() => {});
  }

  return {
    status: report.status,
    issuesFound: issues.length,
    totalVariance: report.totalVariance,
    periodLabel: report.period.label,
  };
}
