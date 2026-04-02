import type { Metadata } from "next";
import { headers } from "next/headers";
import type { TruthBenchmarkSummary } from "@/lib/ops/abra-truth-benchmark";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Accuracy" };

type FetchState = {
  report: TruthBenchmarkSummary | null;
  error: string | null;
};

async function fetchAccuracyReport(): Promise<FetchState> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    const proto = h.get("x-forwarded-proto") || "http";

    if (!host) {
      return { report: null, error: "Unable to resolve host for accuracy fetch." };
    }

    const res = await fetch(`${proto}://${host}/api/ops/abra/accuracy`, {
      cache: "no-store",
    });

    if (!res.ok) {
      return { report: null, error: `Accuracy API failed (${res.status}).` };
    }

    const json = (await res.json()) as TruthBenchmarkSummary;
    return { report: json, error: null };
  } catch (error) {
    return {
      report: null,
      error: error instanceof Error ? error.message : "Failed to load accuracy report.",
    };
  }
}

function fmtPct(value: number): string {
  return `${Number(value || 0).toFixed(1)}%`;
}

function trendBadge(ok: boolean, goodLabel: string, warnLabel: string) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${
        ok
          ? "bg-emerald-100 text-emerald-800"
          : "bg-amber-100 text-amber-800"
      }`}
    >
      <span>{ok ? "✅" : "⚠️"}</span>
      <span>{ok ? goodLabel : warnLabel}</span>
    </span>
  );
}

export default async function AccuracyPage() {
  const { report, error } = await fetchAccuracyReport();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Abra Accuracy</h1>
        <p className="mt-1 text-sm text-slate-600">
          Truth benchmark and correction telemetry for recent answers.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      {!report ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
          No report available yet.
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Total Answers
              </div>
              <div className="mt-2 text-3xl font-bold text-slate-900">
                {report.overall.totalAnswers.toLocaleString("en-US")}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Correction Rate
              </div>
              <div className="mt-2 text-3xl font-bold text-slate-900">
                {fmtPct(report.overall.correctionRate)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {report.overall.correctedAnswers.toLocaleString("en-US")} corrected answers
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Feedback Score
              </div>
              <div className="mt-2 text-3xl font-bold text-slate-900">
                {fmtPct(report.overall.feedbackScore)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                👍 {report.overall.positiveFeedback} / 👎 {report.overall.negativeFeedback}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">Trend Indicators</div>
            <div className="flex flex-wrap gap-2">
              {trendBadge(
                report.trends.correctionRateImproving,
                "Correction rate improving",
                "Correction rate needs work",
              )}
              {trendBadge(
                report.trends.confidenceCalibrated,
                "Confidence calibrated",
                "Confidence calibration needs work",
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">Department Breakdown</div>
            {report.byDepartment.length === 0 ? (
              <div className="text-sm text-slate-600">No department-level records yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-2">Department</th>
                      <th className="px-2 py-2">Total</th>
                      <th className="px-2 py-2">Corrected</th>
                      <th className="px-2 py-2">Correction Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byDepartment.map((row: any) => {
                      const rate = (row.correction_rate || 0) * 100;
                      return (
                        <tr key={row.department} className="border-b border-slate-100 last:border-0">
                          <td className="px-2 py-2 font-medium text-slate-900">{row.department}</td>
                          <td className="px-2 py-2 text-slate-700">{row.total_answers}</td>
                          <td className="px-2 py-2 text-slate-700">{row.corrected_answers}</td>
                          <td className="px-2 py-2">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                rate <= 10
                                  ? "bg-emerald-100 text-emerald-800"
                                  : rate <= 20
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-rose-100 text-rose-800"
                              }`}
                            >
                              {rate.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="text-xs text-slate-500">
            Generated: {new Date(report.generatedAt).toLocaleString("en-US")}
          </div>
        </>
      )}
    </div>
  );
}
