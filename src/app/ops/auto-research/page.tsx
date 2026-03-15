import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Auto Research" };

// ---------------------------------------------------------------------------
// Types (mirror API response shapes)
// ---------------------------------------------------------------------------

type EvalRun = {
  id: string;
  prompt_version: number;
  sample_size: number;
  criteria_scores: Record<string, number>;
  overall_score: number;
  is_winner: boolean;
  total_cost_usd: number;
  created_at: string;
};

type PromptVersion = {
  version: number;
  status: string;
  overall_score: number | null;
  mutation_description: string | null;
  parent_version: number | null;
  created_at: string;
};

type DashboardData = {
  target_key: string;
  supported_targets: string[];
  runs: EvalRun[];
  versions: PromptVersion[];
  active_version: PromptVersion | null;
  candidate_versions: PromptVersion[];
} | null;

// ---------------------------------------------------------------------------
// Target display names
// ---------------------------------------------------------------------------

const TARGET_LABELS: Record<string, string> = {
  email_drafter: "📧 Email Drafter",
  financial_processor: "💰 Financial Processor",
  slack_processor: "💬 Slack Processor",
  weekly_digest: "📊 Weekly Digest",
  strategy_orchestrator: "🎯 Strategy Orchestrator",
  blog_drafter: "📝 Blog Drafter",
  social_responder: "🐦 Social Responder",
  social_post_generator: "📣 Social Post Generator",
  morning_brief: "🌅 Morning Brief",
  anomaly_detector: "🔍 Anomaly Detector",
  pipeline_intel: "🎯 Pipeline Intel",
  operational_signals: "📡 Operational Signals",
  b2b_outreach: "📧 B2B Outreach",
  b2b_reply_classifier: "🏷️ Reply Classifier",
  b2b_forecaster: "📈 B2B Forecaster",
  b2b_deal_tracker: "🤝 Deal Tracker",
  b2b_win_loss: "🏆 Win/Loss Analysis",
  seo_keyword_analyzer: "🔑 SEO Keywords",
  seo_content_gap: "📝 SEO Content Gap",
  dtc_post_purchase: "📦 Post-Purchase",
  dtc_cart_recovery: "🛒 Cart Recovery",
  supply_demand_forecast: "📊 Demand Forecast",
  finops_reconciler: "🧾 Transaction Classifier",
  finops_cashflow: "💵 Cash Flow",
  finops_pnl: "📑 P&L Commentary",
  social_engagement: "💬 Social Engagement",
  social_analysis: "📊 Social Analysis",
  b2b_reengagement: "🔄 Re-engagement",
};

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function fetchDashboard(targetKey: string): Promise<{
  data: DashboardData;
  error: string | null;
}> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    const proto = h.get("x-forwarded-proto") || "http";

    if (!host) {
      return { data: null, error: "Unable to resolve host." };
    }

    const res = await fetch(
      `${proto}://${host}/api/ops/abra/auto-research?target_key=${targetKey}&limit=30`,
      { cache: "no-store" },
    );

    if (!res.ok) {
      return { data: null, error: `API failed (${res.status}).` };
    }

    const json = (await res.json()) as DashboardData;
    return { data: json, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to load.",
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPct(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/New_York",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function scoreColor(score: number): string {
  if (score >= 0.9) return "bg-emerald-100 text-emerald-800";
  if (score >= 0.7) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
}

function statusBadge(status: string): string {
  switch (status) {
    case "active":
      return "bg-emerald-100 text-emerald-800";
    case "candidate":
      return "bg-blue-100 text-blue-800";
    case "baseline":
      return "bg-gray-100 text-gray-600";
    case "retired":
      return "bg-gray-100 text-gray-400";
    default:
      return "bg-gray-100 text-gray-500";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default async function AutoResearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const targetKey = (typeof params.target === "string" ? params.target : null) || "email_drafter";
  const { data, error } = await fetchDashboard(targetKey);

  const supportedTargets = data?.supported_targets || Object.keys(TARGET_LABELS);

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            🧬 Auto Research
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Self-improving agent prompts via eval → mutate → promote
          </p>
        </div>
        <div className="flex gap-2">
          <form action="/api/ops/abra/auto-research" method="POST">
            <input type="hidden" name="target_key" value={targetKey} />
            <input type="hidden" name="sample_size" value="5" />
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Run Eval
            </button>
          </form>
          <form action="/api/ops/abra/auto-research" method="POST">
            <input type="hidden" name="target_key" value={targetKey} />
            <input type="hidden" name="mutation_only" value="true" />
            <button
              type="submit"
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
            >
              Generate Mutation
            </button>
          </form>
        </div>
      </div>

      {/* Target Selector */}
      <div className="flex flex-wrap gap-2">
        {supportedTargets.map((t) => (
          <Link
            key={t}
            href={`/ops/auto-research?target=${t}`}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              t === targetKey
                ? "bg-indigo-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {TARGET_LABELS[t] || t}
          </Link>
        ))}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!data && !error && (
        <div className="rounded-lg bg-gray-50 p-8 text-center text-gray-500">
          No auto-research data yet. Run your first eval to get started.
        </div>
      )}

      {data && (
        <>
          {/* Active Version Card */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Active Prompt — {TARGET_LABELS[data.target_key] || data.target_key}
            </h2>
            {data.active_version ? (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">
                    Version
                  </p>
                  <p className="text-2xl font-bold text-gray-900">
                    v{data.active_version.version}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">
                    Score
                  </p>
                  <p className="text-2xl font-bold text-gray-900">
                    {fmtPct(data.active_version.overall_score)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">
                    Promoted
                  </p>
                  <p className="text-sm text-gray-700">
                    {fmtDate(data.active_version.created_at)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-gray-500">No active version</p>
            )}

            {data.candidate_versions.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
                  Candidates ({data.candidate_versions.length})
                </p>
                <div className="space-y-2">
                  {data.candidate_versions.map((v) => (
                    <div
                      key={v.version}
                      className="flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2"
                    >
                      <span className="text-sm font-medium text-blue-900">
                        v{v.version}
                      </span>
                      <span className="text-xs text-blue-600">
                        {v.mutation_description || "—"}
                      </span>
                      <span className="text-sm text-blue-700">
                        {fmtPct(v.overall_score)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Criteria Breakdown (from latest run) */}
          {data.runs.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Latest Eval Criteria
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {Object.entries(data.runs[0].criteria_scores).map(
                  ([key, score]) => (
                    <div
                      key={key}
                      className={`rounded-lg px-3 py-2 ${scoreColor(score)}`}
                    >
                      <p className="text-xs font-medium truncate">{key}</p>
                      <p className="text-lg font-bold">{fmtPct(score)}</p>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}

          {/* Run History */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Eval History
            </h2>
            {data.runs.length === 0 ? (
              <p className="text-gray-500 text-sm">
                No eval runs yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase">
                      <th className="py-2 pr-4">Date</th>
                      <th className="py-2 pr-4">Version</th>
                      <th className="py-2 pr-4">Score</th>
                      <th className="py-2 pr-4">Samples</th>
                      <th className="py-2 pr-4">Cost</th>
                      <th className="py-2">Winner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.runs.map((run) => (
                      <tr
                        key={run.id}
                        className="border-b border-gray-50 hover:bg-gray-50"
                      >
                        <td className="py-2 pr-4 text-gray-600">
                          {fmtDate(run.created_at)}
                        </td>
                        <td className="py-2 pr-4 font-medium">
                          v{run.prompt_version}
                        </td>
                        <td className="py-2 pr-4">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${scoreColor(run.overall_score)}`}
                          >
                            {fmtPct(run.overall_score)}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-gray-500">
                          {run.sample_size}
                        </td>
                        <td className="py-2 pr-4 text-gray-500">
                          ${run.total_cost_usd.toFixed(4)}
                        </td>
                        <td className="py-2">
                          {run.is_winner && (
                            <span className="text-emerald-600 font-semibold">
                              👑
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Prompt Version History */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Prompt Versions
            </h2>
            <div className="space-y-2">
              {data.versions.map((v) => (
                <div
                  key={v.version}
                  className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-gray-900">
                      v{v.version}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadge(v.status)}`}
                    >
                      {v.status}
                    </span>
                    {v.parent_version && (
                      <span className="text-xs text-gray-400">
                        ← v{v.parent_version}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-gray-500 max-w-xs truncate">
                      {v.mutation_description || "—"}
                    </span>
                    <span className="text-gray-400 text-xs">
                      {fmtDate(v.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
