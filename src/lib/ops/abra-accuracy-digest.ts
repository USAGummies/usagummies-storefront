import { getAccuracyReport } from "@/lib/ops/abra-truth-benchmark";
import { notify } from "@/lib/ops/notify";

function pct(value: number): string {
  return `${Number(value || 0).toFixed(1)}%`;
}

export async function generateWeeklyDigest(): Promise<string> {
  const report = await getAccuracyReport(7);

  const header = `📈 Abra Weekly Accuracy Digest (${new Date().toISOString().slice(0, 10)})`;

  if (report.overall.totalAnswers === 0) {
    const empty = `${header}\n\nNo answers were logged in the last 7 days.`;
    await notify({ channel: "daily", text: empty });
    return empty;
  }

  const byDept = report.byDepartment
    .slice(0, 5)
    .map((row) => {
      const rate = row.total_answers > 0
        ? (row.corrected_answers / row.total_answers) * 100
        : 0;
      return `• ${row.department}: ${row.total_answers} answers, ${rate.toFixed(1)}% corrected`;
    })
    .join("\n");

  const digest = [
    header,
    "",
    `• Total answers: ${report.overall.totalAnswers}`,
    `• Corrected answers: ${report.overall.correctedAnswers}`,
    `• Correction rate: ${pct(report.overall.correctionRate)}`,
    `• Feedback score: ${pct(report.overall.feedbackScore)}`,
    `• Trend: ${report.trends.correctionRateImproving ? "✅ improving" : "⚠️ needs improvement"}`,
    byDept ? `\nBy department:\n${byDept}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  await notify({ channel: "daily", text: digest });
  return digest;
}
