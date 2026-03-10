import { getAccuracyReport } from "@/lib/ops/abra-truth-benchmark";
import { getActiveSignals } from "@/lib/ops/abra-operational-signals";
import {
  getMonthlySpend,
  getSpendByDepartment,
  getSpendByModel,
  logAICost,
} from "@/lib/ops/abra-cost-tracker";
import { notify } from "@/lib/ops/notify";
import { sendOpsEmail } from "@/lib/ops/email";

const DEPARTMENTS = [
  "executive",
  "operations",
  "finance",
  "sales_and_growth",
  "supply_chain",
] as const;

type DepartmentDigest = {
  department: string;
  activeInitiatives: number;
  statusCounts: Record<string, number>;
  openQuestions: number;
  kpiHighlight: string | null;
  weeklySpend: number;
};

type Initiative30DaySummary = {
  department: string;
  started: number;
  completed: number;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}) {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase not configured");

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  headers.set("Content-Type", "application/json");

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(10000),
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!res.ok) {
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${typeof json === "string" ? json : JSON.stringify(json)}`,
    );
  }

  return json;
}

function usd(value: number): string {
  return `$${Number(value || 0).toFixed(2)}`;
}

function sumCosts(rows: Array<{ estimated_cost_usd?: number }>): number {
  return Math.round(
    rows.reduce((sum, row) => sum + Number(row.estimated_cost_usd || 0), 0) * 100,
  ) / 100;
}

function lookbackIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

async function getDepartmentDigest(
  department: string,
  sinceIso: string,
): Promise<DepartmentDigest> {
  const [initiativesRes, questionsRes, kpiRes, costRes] = await Promise.allSettled([
    sbFetch(
      `/rest/v1/abra_initiatives?department=eq.${department}&status=not.in.(completed,paused)&select=status&limit=200`,
    ),
    sbFetch(
      `/rest/v1/abra_unanswered_questions?department=eq.${department}&answered=eq.false&select=id&limit=200`,
    ),
    sbFetch(
      `/rest/v1/open_brain_entries?department=eq.${department}&entry_type=eq.kpi&select=title,summary_text,created_at&order=created_at.desc&limit=1`,
    ),
    sbFetch(
      `/rest/v1/abra_cost_log?department=eq.${department}&created_at=gte.${encodeURIComponent(sinceIso)}&select=estimated_cost_usd&limit=1000`,
    ),
  ]);

  const initiatives = initiativesRes.status === "fulfilled" && Array.isArray(initiativesRes.value)
    ? (initiativesRes.value as Array<{ status?: string }>)
    : [];
  const questions = questionsRes.status === "fulfilled" && Array.isArray(questionsRes.value)
    ? questionsRes.value
    : [];
  const kpis = kpiRes.status === "fulfilled" && Array.isArray(kpiRes.value)
    ? (kpiRes.value as Array<{ title?: string; summary_text?: string }>)
    : [];
  const costRows = costRes.status === "fulfilled" && Array.isArray(costRes.value)
    ? (costRes.value as Array<{ estimated_cost_usd?: number }>)
    : [];

  const statusCounts: Record<string, number> = {};
  for (const row of initiatives) {
    const status = (row.status || "unknown").toString();
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  const kpiHighlight = kpis[0]
    ? [kpis[0].title || "KPI update", kpis[0].summary_text || ""]
        .filter(Boolean)
        .join(" — ")
        .slice(0, 180)
    : null;

  return {
    department,
    activeInitiatives: initiatives.length,
    statusCounts,
    openQuestions: questions.length,
    kpiHighlight,
    weeklySpend: sumCosts(costRows),
  };
}

async function getMeetingCount(sinceIso: string): Promise<number> {
  try {
    const rows = (await sbFetch(
      `/rest/v1/abra_sessions?started_at=gte.${encodeURIComponent(sinceIso)}&select=id&limit=1000`,
    )) as Array<{ id: string }>;
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
}

async function getOpenQuestionList(limit = 5): Promise<string[]> {
  try {
    const rows = (await sbFetch(
      `/rest/v1/abra_unanswered_questions?answered=eq.false&select=department,question&order=created_at.desc&limit=${limit}`,
    )) as Array<{ department?: string; question?: string }>;

    return rows
      .map((row) => {
        const question = (row.question || "").trim();
        const department = (row.department || "general").trim();
        if (!question) return "";
        return `[${department}] ${question}`;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function getInitiative30DaySummary(
  department: string,
  sinceIso: string,
): Promise<Initiative30DaySummary> {
  const [startedRes, completedRes] = await Promise.allSettled([
    sbFetch(
      `/rest/v1/abra_initiatives?department=eq.${department}&created_at=gte.${encodeURIComponent(sinceIso)}&select=id&limit=1000`,
    ),
    sbFetch(
      `/rest/v1/abra_initiatives?department=eq.${department}&status=eq.completed&updated_at=gte.${encodeURIComponent(sinceIso)}&select=id&limit=1000`,
    ),
  ]);

  const startedRows = startedRes.status === "fulfilled" && Array.isArray(startedRes.value)
    ? startedRes.value
    : [];
  const completedRows = completedRes.status === "fulfilled" && Array.isArray(completedRes.value)
    ? completedRes.value
    : [];

  return {
    department,
    started: startedRows.length,
    completed: completedRows.length,
  };
}

export async function generateWeeklyDigest(): Promise<string> {
  const sinceIso = lookbackIso(7);
  const weekLabel = new Date(sinceIso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const [deptRows, accuracy, signals, monthlySpend, openQuestions, meetings] =
    await Promise.all([
      Promise.all(DEPARTMENTS.map((department) => getDepartmentDigest(department, sinceIso))),
      getAccuracyReport(7),
      getActiveSignals({ limit: 200 }),
      getMonthlySpend(),
      getOpenQuestionList(5),
      getMeetingCount(sinceIso),
    ]);

  const signalCounts = {
    critical: signals.filter((signal) => signal.severity === "critical").length,
    warning: signals.filter((signal) => signal.severity === "warning").length,
    info: signals.filter((signal) => signal.severity === "info").length,
  };

  const totalWeeklySpend = Math.round(
    deptRows.reduce((sum, row) => sum + row.weeklySpend, 0) * 100,
  ) / 100;

  const lines: string[] = [];
  lines.push(`📊 *Abra Weekly Digest* — Week of ${weekLabel}`);
  lines.push("");
  lines.push("*Department Summary*");
  for (const row of deptRows) {
    const statuses = Object.entries(row.statusCounts)
      .map(([status, count]) => `${status}:${count}`)
      .join(", ");
    lines.push(
      `• *${row.department.replace(/_/g, " ")}* — initiatives: ${row.activeInitiatives}${statuses ? ` (${statuses})` : ""}; open questions: ${row.openQuestions}; weekly AI spend: ${usd(row.weeklySpend)}`,
    );
    if (row.kpiHighlight) {
      lines.push(`  KPI: ${row.kpiHighlight}`);
    }
  }

  lines.push("");
  lines.push(
    `*AI Spend* — ${usd(totalWeeklySpend)} this week / ${usd(monthlySpend.total)} this month (budget: ${usd(monthlySpend.budget)})`,
  );
  lines.push(
    `*Accuracy (7d)* — ${accuracy.overall.totalAnswers} answers, ${accuracy.overall.correctionRate}% correction rate`,
  );
  lines.push(
    `*Meetings (7d)* — ${meetings}`,
  );
  lines.push(
    `*Active Signals* — critical: ${signalCounts.critical}, warning: ${signalCounts.warning}, info: ${signalCounts.info}`,
  );

  lines.push("");
  lines.push("*Open Questions (max 5)*");
  if (openQuestions.length === 0) {
    lines.push("• None");
  } else {
    for (const question of openQuestions) {
      lines.push(`• ${question}`);
    }
  }

  return lines.join("\n");
}

export async function sendWeeklyDigest(): Promise<void> {
  const digest = await generateWeeklyDigest();
  await notify({ channel: "daily", text: digest });

  const approxTokens = Math.max(200, Math.round(digest.length / 4));
  void logAICost({
    model: "claude-3-5-haiku-latest",
    provider: "anthropic",
    inputTokens: approxTokens,
    outputTokens: 0,
    endpoint: "digest/weekly",
    department: "executive",
  });
}

export async function generateMonthlyReport(): Promise<string> {
  const sinceIso = lookbackIso(30);
  const monthLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const [deptRows, initiativeSummary, accuracy, monthlySpend, byModel, byDepartment, meetings] =
    await Promise.all([
      Promise.all(DEPARTMENTS.map((department) => getDepartmentDigest(department, sinceIso))),
      Promise.all(DEPARTMENTS.map((department) => getInitiative30DaySummary(department, sinceIso))),
      getAccuracyReport(30),
      getMonthlySpend(),
      getSpendByModel(),
      getSpendByDepartment(),
      getMeetingCount(sinceIso),
    ]);

  const initiativeRows = initiativeSummary
    .map((row) => `<tr><td>${row.department}</td><td>${row.started}</td><td>${row.completed}</td></tr>`)
    .join("");

  const modelRows = Object.entries(byModel)
    .map(([model, cost]) => `<tr><td>${model}</td><td>${usd(cost)}</td></tr>`)
    .join("");

  const deptCostRows = Object.entries(byDepartment)
    .map(([department, cost]) => `<tr><td>${department}</td><td>${usd(cost)}</td></tr>`)
    .join("");

  const deptSummaryRows = deptRows
    .map(
      (row) =>
        `<tr><td>${row.department}</td><td>${row.activeInitiatives}</td><td>${row.openQuestions}</td><td>${usd(row.weeklySpend)}</td></tr>`,
    )
    .join("");

  const trendText = accuracy.trends.correctionRateImproving
    ? "Improving"
    : "Declining";

  return `
    <h2>Abra Monthly Report — ${monthLabel}</h2>
    <p><strong>AI Spend:</strong> ${usd(monthlySpend.total)} / ${usd(monthlySpend.budget)} (${monthlySpend.pctUsed}% used)</p>
    <p><strong>Accuracy (30d):</strong> ${accuracy.overall.totalAnswers} answers, ${accuracy.overall.correctionRate}% correction rate (${trendText})</p>
    <p><strong>Meetings (30d):</strong> ${meetings}</p>

    <h3>Department Snapshot</h3>
    <table border="1" cellpadding="6" cellspacing="0">
      <thead><tr><th>Department</th><th>Active Initiatives</th><th>Open Questions</th><th>30d AI Spend</th></tr></thead>
      <tbody>${deptSummaryRows}</tbody>
    </table>

    <h3>Initiative Progress (30d)</h3>
    <table border="1" cellpadding="6" cellspacing="0">
      <thead><tr><th>Department</th><th>Started</th><th>Completed</th></tr></thead>
      <tbody>${initiativeRows}</tbody>
    </table>

    <h3>Cost Breakdown by Model</h3>
    <table border="1" cellpadding="6" cellspacing="0">
      <thead><tr><th>Model</th><th>Cost</th></tr></thead>
      <tbody>${modelRows || "<tr><td colspan=\"2\">No usage</td></tr>"}</tbody>
    </table>

    <h3>Cost Breakdown by Department</h3>
    <table border="1" cellpadding="6" cellspacing="0">
      <thead><tr><th>Department</th><th>Cost</th></tr></thead>
      <tbody>${deptCostRows || "<tr><td colspan=\"2\">No usage</td></tr>"}</tbody>
    </table>
  `.trim();
}

export async function sendMonthlyReport(): Promise<void> {
  const html = await generateMonthlyReport();
  const monthLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  await sendOpsEmail({
    to: "ben@usagummies.com",
    subject: `Abra Monthly Report — ${monthLabel}`,
    body: html,
    allowRepeat: true,
  });

  const approxTokens = Math.max(400, Math.round(html.length / 4));
  void logAICost({
    model: "claude-3-5-haiku-latest",
    provider: "anthropic",
    inputTokens: approxTokens,
    outputTokens: 0,
    endpoint: "digest/monthly",
    department: "executive",
  });
}
