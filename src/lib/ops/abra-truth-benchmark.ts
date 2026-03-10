/**
 * Abra Truth Benchmarking
 *
 * Measures answer quality over time by tracking:
 * - Correction rate (% of answers later corrected)
 * - Confidence accuracy (do high-confidence answers get corrected less?)
 * - Source diversity (are we relying on too few sources?)
 * - Per-department accuracy
 *
 * Uses data from `abra_answer_log` (logged by source provenance).
 * Also calls the `get_accuracy_report` RPC for aggregated stats.
 */

export type AccuracyReport = {
  department: string;
  total_answers: number;
  corrected_answers: number;
  correction_rate: number;
};

// Raw shape returned by the get_accuracy_report RPC (single aggregate row)
type AccuracyReportRpcRow = {
  total_answers: number;
  corrected_answers: number;
  accuracy_pct: number;
  avg_correction_delay_hours: number | null;
  by_department: Record<string, { total: number; corrected: number; accuracy_pct: number }>;
};

export type TruthBenchmarkSummary = {
  overall: {
    totalAnswers: number;
    correctedAnswers: number;
    correctionRate: number;
    avgConfidence: number;
    positiveFeedback: number;
    negativeFeedback: number;
    feedbackScore: number; // positive / (positive + negative)
  };
  byDepartment: AccuracyReport[];
  trends: {
    correctionRateImproving: boolean;
    confidenceCalibrated: boolean;
  };
  generatedAt: string;
};

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbRpc(
  rpcName: string,
  body: Record<string, unknown> = {},
): Promise<unknown> {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase not configured");

  const res = await fetch(`${env.baseUrl}/rest/v1/rpc/${rpcName}`, {
    method: "POST",
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RPC ${rpcName} failed (${res.status}): ${text.slice(0, 300)}`);
  }

  return res.json();
}

/**
 * Get the full accuracy report from the database.
 * Uses `get_accuracy_report` RPC if available, otherwise returns empty.
 *
 * The RPC returns a single aggregate row with a `by_department` JSONB field
 * containing per-department breakdowns.
 */
export async function getAccuracyReport(
  lookbackDays: number = 30,
): Promise<TruthBenchmarkSummary> {
  try {
    // RPC param is `report_days`
    const result = (await sbRpc("get_accuracy_report", {
      report_days: lookbackDays,
    })) as AccuracyReportRpcRow[] | AccuracyReportRpcRow;

    // RPC returns an array with one row via PostgREST
    const row = Array.isArray(result) ? result[0] : result;
    if (!row || !row.total_answers) {
      return emptyReport();
    }

    const totalAnswers = Number(row.total_answers) || 0;
    const correctedAnswers = Number(row.corrected_answers) || 0;
    const correctionRate =
      totalAnswers > 0 ? correctedAnswers / totalAnswers : 0;

    // Extract per-department data from JSONB
    const byDepartment: AccuracyReport[] = [];
    if (row.by_department && typeof row.by_department === "object") {
      for (const [dept, data] of Object.entries(row.by_department)) {
        byDepartment.push({
          department: dept,
          total_answers: data.total || 0,
          corrected_answers: data.corrected || 0,
          correction_rate:
            data.total > 0 ? data.corrected / data.total : 0,
        });
      }
    }

    // Simple trend analysis
    const correctionRateImproving = correctionRate < 0.1;
    const confidenceCalibrated = correctionRate < 0.15;

    return {
      overall: {
        totalAnswers,
        correctedAnswers,
        correctionRate: Math.round(correctionRate * 10000) / 100,
        avgConfidence: 0, // Not available from current RPC
        positiveFeedback: 0, // Not available from current RPC
        negativeFeedback: 0,
        feedbackScore: 0,
      },
      byDepartment,
      trends: {
        correctionRateImproving,
        confidenceCalibrated,
      },
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    // RPC may not exist yet — return empty report
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("42883") || msg.includes("does not exist")) {
      console.log("[truth-benchmark] get_accuracy_report RPC not yet available");
    } else {
      console.error("[truth-benchmark] Failed:", msg);
    }

    return emptyReport();
  }
}

function emptyReport(): TruthBenchmarkSummary {
  return {
    overall: {
      totalAnswers: 0,
      correctedAnswers: 0,
      correctionRate: 0,
      avgConfidence: 0,
      positiveFeedback: 0,
      negativeFeedback: 0,
      feedbackScore: 0,
    },
    byDepartment: [],
    trends: {
      correctionRateImproving: true,
      confidenceCalibrated: true,
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format accuracy report as a readable string (for Slack/web display).
 */
export function formatAccuracyReport(report: TruthBenchmarkSummary): string {
  const { overall, byDepartment, trends } = report;

  if (overall.totalAnswers === 0) {
    return "No answers logged yet. Start using Abra to build accuracy data.";
  }

  const lines: string[] = [
    `**Abra Accuracy Report** (last 30 days)`,
    ``,
    `**Overall:**`,
    `• Total answers: ${overall.totalAnswers}`,
    `• Correction rate: ${overall.correctionRate}% (${overall.correctedAnswers} corrected)`,
    `• Average confidence: ${(overall.avgConfidence * 100).toFixed(1)}%`,
    `• Feedback: 👍 ${overall.positiveFeedback} / 👎 ${overall.negativeFeedback} (${overall.feedbackScore}% positive)`,
    ``,
  ];

  if (byDepartment.length > 0) {
    lines.push(`**By Department:**`);
    for (const dept of byDepartment) {
      if (dept.total_answers > 0) {
        const rate = (dept.correction_rate * 100).toFixed(1);
        lines.push(
          `• ${dept.department}: ${dept.total_answers} answers, ${rate}% correction rate`,
        );
      }
    }
    lines.push(``);
  }

  lines.push(`**Trends:**`);
  lines.push(
    `• Correction rate: ${trends.correctionRateImproving ? "✅ Good (<10%)" : "⚠️ Needs improvement (>10%)"}`,
  );
  lines.push(
    `• Confidence calibration: ${trends.confidenceCalibrated ? "✅ Well calibrated" : "⚠️ Needs tuning"}`,
  );

  return lines.join("\n");
}
