import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VALID_DEPARTMENTS = [
  "executive",
  "operations",
  "finance",
  "sales_and_growth",
  "supply_chain",
] as const;

type DepartmentState = {
  department: {
    name?: string;
    owner_name?: string;
    description?: string;
    key_context?: string;
    current_priorities?: unknown[];
  } | null;
  initiatives: Array<Record<string, unknown>>;
  open_questions: Array<Record<string, unknown>>;
  recent_corrections: Array<Record<string, unknown>>;
  kpis: Array<Record<string, unknown>>;
  ai_spend?: { this_month?: number };
  team_members: Array<Record<string, unknown>>;
  dashboard_config?: Record<string, unknown>;
  generated_at?: string;
};

type FetchResult = {
  data: DepartmentState | null;
  error: string | null;
};

type DependencyNode = {
  dependency_id?: string;
  initiative_id?: string;
  title?: string;
  department?: string;
  status?: string;
  relationship_type?: string;
};

type InitiativeWithDependencies = Record<string, unknown> & {
  id?: string;
  title?: string;
  goal?: string;
  status?: string;
  blocks?: DependencyNode[];
  blocked_by?: DependencyNode[];
  informs?: DependencyNode[];
  informed_by?: DependencyNode[];
};

export const metadata: Metadata = {
  title: "Department Dashboard",
};

function formatDepartmentName(dept: string): string {
  return dept
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function valueText(value: unknown, fallback = "—"): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

async function fetchDepartmentState(dept: string): Promise<FetchResult> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    const proto = h.get("x-forwarded-proto") || "http";

    if (!host) {
      return { data: null, error: "Unable to resolve host for department fetch." };
    }

    const res = await fetch(`${proto}://${host}/api/ops/department/${dept}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      return {
        data: null,
        error: `Department API failed (${res.status})`,
      };
    }

    const json = (await res.json()) as DepartmentState;
    return { data: json, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to load department dashboard.",
    };
  }
}

async function fetchInitiativesWithDependencies(
  dept: string,
): Promise<InitiativeWithDependencies[]> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    const proto = h.get("x-forwarded-proto") || "http";
    if (!host) return [];

    const res = await fetch(
      `${proto}://${host}/api/ops/abra/initiative?department=${dept}&status=active&include_dependencies=true`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      initiatives?: InitiativeWithDependencies[];
    };
    return Array.isArray(json.initiatives) ? json.initiatives : [];
  } catch {
    return [];
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "approved":
    case "completed":
      return "bg-emerald-100 text-emerald-800";
    case "executing":
      return "bg-blue-100 text-blue-800";
    case "asking_questions":
    case "planning":
      return "bg-amber-100 text-amber-800";
    case "paused":
      return "bg-slate-200 text-slate-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export default async function DepartmentPage({
  params,
}: {
  params: Promise<{ dept: string }>;
}) {
  const { dept } = await params;

  if (!VALID_DEPARTMENTS.includes(dept as (typeof VALID_DEPARTMENTS)[number])) {
    notFound();
  }

  const [{ data, error }, dependencyInitiatives] = await Promise.all([
    fetchDepartmentState(dept),
    fetchInitiativesWithDependencies(dept),
  ]);

  const initiatives = Array.isArray(data?.initiatives) ? data.initiatives : [];
  const openQuestions = Array.isArray(data?.open_questions)
    ? data.open_questions
    : [];
  const recentCorrections = Array.isArray(data?.recent_corrections)
    ? data.recent_corrections
    : [];
  const kpis = Array.isArray(data?.kpis) ? data.kpis : [];
  const teamMembers = Array.isArray(data?.team_members) ? data.team_members : [];
  const blockedInitiatives = dependencyInitiatives.filter((initiative) =>
    Array.isArray(initiative.blocked_by) && initiative.blocked_by.length > 0,
  );
  const blockingOthers = dependencyInitiatives
    .flatMap((initiative) => {
      const sourceTitle = valueText(
        initiative.title,
        valueText(initiative.goal, "Untitled initiative"),
      );
      const deps = Array.isArray(initiative.blocks) ? initiative.blocks : [];
      return deps.map((dependency) => ({
        sourceTitle,
        sourceStatus: valueText(initiative.status, "unknown"),
        targetTitle: valueText(dependency.title, "Untitled initiative"),
        targetDepartment: valueText(dependency.department, "unknown"),
        targetStatus: valueText(dependency.status, "unknown"),
      }));
    })
    .filter((item) => item.targetDepartment !== dept);
  const informationalLinks = dependencyInitiatives.flatMap((initiative) => {
    const sourceTitle = valueText(
      initiative.title,
      valueText(initiative.goal, "Untitled initiative"),
    );
    const outward = Array.isArray(initiative.informs)
      ? initiative.informs.map((dependency) => ({
          sourceTitle,
          targetTitle: valueText(dependency.title, "Untitled initiative"),
          targetDepartment: valueText(dependency.department, "unknown"),
        }))
      : [];
    const inward = Array.isArray(initiative.informed_by)
      ? initiative.informed_by.map((dependency) => ({
          sourceTitle,
          targetTitle: valueText(dependency.title, "Untitled initiative"),
          targetDepartment: valueText(dependency.department, "unknown"),
        }))
      : [];
    return [...outward, ...inward];
  });

  const priorities = Array.isArray(data?.department?.current_priorities)
    ? data?.department?.current_priorities
    : [];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h1 className="text-2xl font-bold text-slate-900">
          {formatDepartmentName(dept)} Department
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {valueText(data?.department?.description, "Department dashboard and operational state.")}
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
          <span>Owner: {valueText(data?.department?.owner_name, "Unassigned")}</span>
          <span>AI Spend (month): ${Number(data?.ai_spend?.this_month || 0).toFixed(2)}</span>
          <span>
            Generated:{" "}
            {data?.generated_at
              ? new Date(data.generated_at).toLocaleString("en-US")
              : "—"}
          </span>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active Initiatives</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{initiatives.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open Questions</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{openQuestions.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Team Members</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{teamMembers.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent Corrections</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{recentCorrections.length}</div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 text-sm font-semibold text-slate-900">Active Initiatives</div>
          {initiatives.length === 0 ? (
            <div className="text-sm text-slate-600">No active initiatives.</div>
          ) : (
            <div className="space-y-2">
              {initiatives.map((initiative) => {
                const id = valueText(initiative.id, "");
                const status = valueText(initiative.status, "unknown");
                const title = valueText(
                  initiative.title,
                  valueText(initiative.goal, "Untitled initiative"),
                );
                return (
                  <div key={id || `${title}-${status}`} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{title}</div>
                        <div className="mt-1 text-xs text-slate-500">{valueText(initiative.goal, "No goal specified")}</div>
                      </div>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(status)}`}>
                        {status.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 text-sm font-semibold text-slate-900">Current Priorities</div>
          {priorities.length === 0 ? (
            <div className="text-sm text-slate-600">No priorities configured.</div>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              {priorities.map((priority, idx) => (
                <li key={`${idx}-${valueText(priority)}`}>{valueText(priority)}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 text-sm font-semibold text-slate-900">Open Questions</div>
          {openQuestions.length === 0 ? (
            <div className="text-sm text-slate-600">No open questions.</div>
          ) : (
            <ul className="space-y-2 text-sm text-slate-700">
              {openQuestions.slice(0, 12).map((question) => (
                <li key={valueText(question.id, valueText(question.question))} className="rounded-lg border border-slate-200 p-2">
                  <div className="font-medium text-slate-900">{valueText(question.question)}</div>
                  <div className="mt-1 text-xs text-slate-500">Asked by: {valueText(question.asked_by, "Unknown")}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 text-sm font-semibold text-slate-900">Team Members</div>
          {teamMembers.length === 0 ? (
            <div className="text-sm text-slate-600">No team members mapped to this department.</div>
          ) : (
            <ul className="space-y-2 text-sm text-slate-700">
              {teamMembers.slice(0, 12).map((member) => {
                const name = valueText(member.name, "Unknown");
                const role = valueText(member.role, "Role not set");
                const email = valueText(member.email, "");
                return (
                  <li key={`${name}-${email}-${role}`} className="rounded-lg border border-slate-200 p-2">
                    <div className="font-medium text-slate-900">{name}</div>
                    <div className="text-xs text-slate-500">{role}</div>
                    {email !== "—" ? <div className="text-xs text-slate-500">{email}</div> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-slate-900">KPIs and Corrections</div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">KPIs</div>
            {kpis.length === 0 ? (
              <div className="text-sm text-slate-600">No KPI entries yet.</div>
            ) : (
              <ul className="space-y-2 text-sm text-slate-700">
                {kpis.slice(0, 10).map((kpi) => (
                  <li key={valueText(kpi.id, valueText(kpi.title))} className="rounded-lg border border-slate-200 p-2">
                    <div className="font-medium text-slate-900">{valueText(kpi.title, "Untitled KPI")}</div>
                    <div className="text-xs text-slate-500">{valueText(kpi.summary_text, valueText(kpi.raw_text, "No summary"))}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Recent Corrections</div>
            {recentCorrections.length === 0 ? (
              <div className="text-sm text-slate-600">No recent corrections.</div>
            ) : (
              <ul className="space-y-2 text-sm text-slate-700">
                {recentCorrections.slice(0, 10).map((correction) => (
                  <li key={valueText(correction.id, valueText(correction.correction))} className="rounded-lg border border-slate-200 p-2">
                    <div className="font-medium text-slate-900">{valueText(correction.correction, "Correction")}</div>
                    <div className="text-xs text-slate-500">Original: {valueText(correction.original_claim, "—")}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-slate-900">Dependencies</div>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-700">
              Blocked Initiatives
            </div>
            {blockedInitiatives.length === 0 ? (
              <div className="text-sm text-slate-600">No blocked initiatives.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {blockedInitiatives.slice(0, 12).map((initiative) => {
                  const title = valueText(
                    initiative.title,
                    valueText(initiative.goal, "Untitled initiative"),
                  );
                  const blockers = Array.isArray(initiative.blocked_by)
                    ? initiative.blocked_by
                    : [];
                  return (
                    <li
                      key={`${valueText(initiative.id, title)}-blocked`}
                      className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-rose-900"
                    >
                      <div className="font-medium">{title}</div>
                      <div className="mt-1 text-xs text-rose-800">
                        Blocked by:{" "}
                        {blockers
                          .slice(0, 3)
                          .map((blocker) =>
                            `${valueText(blocker.title, "Untitled")} (${valueText(blocker.department, "unknown").replace(/_/g, " ")})`,
                          )
                          .join(", ")}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
              This Department Blocks
            </div>
            {blockingOthers.length === 0 ? (
              <div className="text-sm text-slate-600">No cross-department blockers.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {blockingOthers.slice(0, 12).map((item, idx) => (
                  <li
                    key={`${item.sourceTitle}-${item.targetTitle}-${idx}`}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-900"
                  >
                    <div className="font-medium">{item.targetTitle}</div>
                    <div className="mt-1 text-xs text-emerald-800">
                      Blocked by {item.sourceTitle} ({item.sourceStatus.replace(/_/g, " ")})
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
              Informational Links
            </div>
            {informationalLinks.length === 0 ? (
              <div className="text-sm text-slate-600">No informational links.</div>
            ) : (
              <ul className="space-y-2 text-sm text-slate-700">
                {informationalLinks.slice(0, 12).map((item, idx) => (
                  <li
                    key={`${item.sourceTitle}-${item.targetTitle}-${idx}-info`}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-2"
                  >
                    <div className="font-medium text-slate-900">{item.sourceTitle}</div>
                    <div className="mt-1 text-xs text-slate-600">
                      Linked with {item.targetTitle} ({item.targetDepartment.replace(/_/g, " ")})
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
