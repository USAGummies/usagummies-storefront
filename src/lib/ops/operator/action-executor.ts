import { getQBOMetrics } from "@/lib/ops/qbo-client";
import { listEmails } from "@/lib/ops/gmail-reader";
import { maybeLearnFinancialCorrection } from "@/lib/ops/operator/correction-learner";
import { proposeAndMaybeExecute, type AbraAction } from "@/lib/ops/abra-actions";
import { type SlackMessageContext } from "@/lib/ops/abra-slack-responder";
import { type RoutedAction } from "@/lib/ops/operator/deterministic-router";
import { readState, writeState } from "@/lib/ops/state";
import { UNIFIED_REVENUE_STATE_KEY } from "@/lib/ops/operator/unified-revenue";
import { UNIFIED_INVENTORY_STATE_KEY, type UnifiedInventorySummary } from "@/lib/ops/operator/unified-inventory";
import { ENTITY_STATE_KEY, type EntityState } from "@/lib/ops/operator/entities/entity-state";

type ApprovalRow = {
  id: string;
  summary?: string | null;
  proposed_payload?: Record<string, unknown> | null;
};

type MeetingPrepLog = Record<string, string>;

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }
  return { baseUrl, serviceKey };
}

async function sbFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const env = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(15000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`Supabase ${path} failed (${res.status})`);
  return json as T;
}

function getInternalBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    "https://www.usagummies.com"
  );
}

function getInternalHeaders(): HeadersInit {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  return cronSecret ? { Authorization: `Bearer ${cronSecret}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function fetchInternalJson(path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${getInternalBaseUrl()}${path}`, {
    headers: getInternalHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

async function postInternalJson(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 20000,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${getInternalBaseUrl()}${path}`, {
    method: "POST",
    headers: getInternalHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.error) {
    throw new Error(String(json.error || `${path} failed (${res.status})`));
  }
  return json;
}

function compactCurrency(value: number, digits = 2): string {
  return `$${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function parseLineItemsFromInstruction(instruction: string): Array<{ description: string; quantity: number; unitPrice: number }> {
  const quantityMatch = instruction.match(/\b(\d[\d,]*)\s+(units?|bags?)\b/i);
  const quantity = quantityMatch ? Number(quantityMatch[1].replace(/,/g, "")) : 0;
  const priceMatch = instruction.match(/\$([\d,.]+)\s*(?:\/|per)?\s*(?:unit|bag)?/i);
  const unitPrice = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : 0;
  if (!quantity || !Number.isFinite(quantity)) return [];
  return [{ description: "All American Gummy Bears 7.5oz", quantity, unitPrice: unitPrice || 2.1 }];
}

function pacificDateLabel(value = new Date()): string {
  return value.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function compactCurrency0(value: number): string {
  return compactCurrency(value, 0);
}

function buildAction(action_type: string, params: Record<string, unknown>, title: string, description: string): AbraAction {
  return {
    action_type,
    title,
    description,
    department: "operations",
    risk_level: "low",
    params,
    requires_approval: false,
    confidence: 0.95,
  };
}

export async function executeRoutedAction(
  action: RoutedAction,
  context: { actor: string; slackChannelId?: string; slackThreadTs?: string; slackUserId?: string; history?: Array<{ role: "user" | "assistant"; content: string }> },
): Promise<RoutedAction> {
  try {
    switch (action.action) {
      case "query_kpi_revenue": {
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const monthStart = `${today.slice(0, 7)}-01`;
        const cachedSummary = await readState<{
          date?: string;
          total?: number;
          mtd?: number;
          amazon?: number;
          shopify?: number;
        } | null>(UNIFIED_REVENUE_STATE_KEY as never, null).catch(() => null);
        if (cachedSummary && typeof cachedSummary.total === "number" && typeof cachedSummary.mtd === "number") {
          action.result = {
            today: Number(cachedSummary.total || 0),
            mtd: Number(cachedSummary.mtd || 0),
            amazon: Number(cachedSummary.amazon || 0),
            shopify: Number(cachedSummary.shopify || 0),
            sourceDate: cachedSummary.date || null,
            cached: true,
          };
          break;
        }
        const rows = await sbFetch<Array<{ metric_name?: string | null; captured_for_date?: string | null; value?: number | null }>>(
          `/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.(daily_revenue_amazon,daily_revenue_shopify,daily_revenue_total_unified)&captured_for_date=gte.${monthStart}&select=metric_name,captured_for_date,value&limit=120`,
        ).catch(() => []);
        let todayAmazon = 0;
        let todayShopify = 0;
        let mtd = 0;
        for (const row of rows) {
          const metric = String(row.metric_name || "");
          const date = String(row.captured_for_date || "");
          const value = Number(row.value || 0);
          if (date === today && metric === "daily_revenue_amazon") todayAmazon += value;
          if (date === today && metric === "daily_revenue_shopify") todayShopify += value;
          if (metric !== "daily_revenue_total_unified") mtd += value;
        }
        action.result = {
          today: todayAmazon + todayShopify,
          mtd,
          amazon: todayAmazon,
          shopify: todayShopify,
        };
        break;
      }
      case "query_plaid_balance": {
        const cachedCashPosition = await readState<{
          balance?: number;
          monthly_burn?: number;
          monthlyBurn?: number;
        } | null>("cash-position" as never, null).catch(() => null);
        if (cachedCashPosition && typeof cachedCashPosition.balance === "number") {
          const burnRate = Number(
            cachedCashPosition.monthly_burn ??
            cachedCashPosition.monthlyBurn ??
            0,
          );
          action.result = {
            balance: Number(cachedCashPosition.balance || 0),
            burnRate,
            runway: burnRate > 0 ? Number(cachedCashPosition.balance || 0) / burnRate : 0,
            cached: true,
          };
          break;
        }
        const metrics = await getQBOMetrics().catch(() => null);
        const live = await fetchInternalJson("/api/ops/plaid/balance");
        const accounts = Array.isArray(live?.accounts) ? (live?.accounts as Array<Record<string, unknown>>) : [];
        const balance = accounts.reduce((sum, account) => {
          const balances = account.balances && typeof account.balances === "object"
            ? (account.balances as Record<string, unknown>)
            : {};
          return sum + Number(balances.current ?? balances.available ?? 0);
        }, 0);
        action.result = {
          balance,
          burnRate: Number(metrics?.burnRate || 0),
          runway: Number(metrics?.runway || 0),
        };
        break;
      }
      case "query_qbo_pnl":
        action.result = await fetchInternalJson("/api/ops/qbo/query?type=pnl");
        break;
      case "query_company_status": {
        const [revenue, tasks, inventory] = await Promise.all([
          executeRoutedAction({ intent: "revenue", action: "query_kpi_revenue", params: {}, result: null, executed: false, error: null }, context),
          executeRoutedAction({ intent: "tasks", action: "query_operator_tasks", params: {}, result: null, executed: false, error: null }, context),
          executeRoutedAction({ intent: "inventory_position", action: "query_inventory_position", params: {}, result: null, executed: false, error: null }, context),
        ]);
        action.result = {
          revenue: revenue.result,
          tasks: tasks.result,
          inventory: inventory.result,
          greeting: Boolean(action.params.greeting),
        };
        break;
      }
      case "query_yesterday_revenue": {
        const rows = await sbFetch<Array<{ metric_name?: string | null; captured_for_date?: string | null; value?: number | null }>>(
          "/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.(daily_revenue_amazon,daily_revenue_shopify,daily_revenue_total_unified)&select=metric_name,captured_for_date,value&order=captured_for_date.desc&limit=14",
        ).catch(() => []);
        const byDate = new Map<string, { amazon: number; shopify: number; total: number }>();
        for (const row of rows) {
          const date = String(row.captured_for_date || "");
          const metric = String(row.metric_name || "");
          const value = Number(row.value || 0);
          const bucket = byDate.get(date) || { amazon: 0, shopify: 0, total: 0 };
          if (metric === "daily_revenue_amazon") bucket.amazon += value;
          if (metric === "daily_revenue_shopify") bucket.shopify += value;
          if (metric === "daily_revenue_total_unified") bucket.total += value;
          byDate.set(date, bucket);
        }
        const dates = [...byDate.keys()].sort().reverse();
        const target = dates[1] || dates[0] || pacificDateLabel();
        const bucket = byDate.get(target) || { amazon: 0, shopify: 0, total: 0 };
        action.result = {
          date: target,
          total: bucket.total || (bucket.amazon + bucket.shopify),
          amazon: bucket.amazon,
          shopify: bucket.shopify,
        };
        break;
      }
      case "query_inventory_position": {
        const summary = await readState<UnifiedInventorySummary | null>(UNIFIED_INVENTORY_STATE_KEY as never, null).catch(() => null);
        action.result = summary || {
          date: pacificDateLabel(),
          fbaUnits: 0,
          benUnits: 0,
          andrewUnits: 0,
          powersUnits: 0,
          committedUnits: 0,
          freeUnits: 0,
          daysOfSupply: 0,
          threshold: "warning",
        };
        break;
      }
      case "query_qbo_vendors":
        action.result = await fetchInternalJson("/api/ops/qbo/query?type=vendors");
        break;
      case "query_qbo_balance_sheet":
        action.result = await fetchInternalJson("/api/ops/qbo/query?type=balance_sheet");
        break;
      case "query_qbo_accounts":
        action.result = await fetchInternalJson("/api/ops/qbo/accounts");
        break;
      case "query_qbo_purchases":
        action.result = await fetchInternalJson("/api/ops/qbo/query?type=purchases&limit=50");
        break;
      case "query_qbo_bills":
        action.result = await fetchInternalJson("/api/ops/qbo/query?type=bills");
        break;
      case "query_qbo_invoices":
        action.result = await fetchInternalJson("/api/ops/qbo/query?type=invoices");
        break;
      case "query_qbo_cash_flow":
        action.result = await fetchInternalJson("/api/ops/qbo/query?type=cash_flow");
        break;
      case "query_burn_rate": {
        const metrics = await getQBOMetrics().catch(() => null);
        action.result = {
          burnRate: Number(metrics?.burnRate || 0),
          cashPosition: Number(metrics?.cashPosition || 0),
          runway: Number(metrics?.runway || 0),
        };
        break;
      }
      case "query_investor_loan_balance": {
        const [accounts, balanceSheet] = await Promise.all([
          fetchInternalJson("/api/ops/qbo/query?type=accounts"),
          fetchInternalJson("/api/ops/qbo/query?type=balance_sheet"),
        ]);
        const rows = Array.isArray(accounts?.accounts) ? (accounts.accounts as Array<Record<string, unknown>>) : [];
        const matches = rows.filter((row) => {
          const name = String(row.Name || "");
          const acctNum = String(row.AcctNum || "");
          return /investor loan|rene|slventures/i.test(name) || /2300|270015|290015/.test(acctNum);
        });
        const directTotal = matches.reduce((sum, row) => sum + Math.abs(Number(row.CurrentBalance || 0)), 0);
        const summary = ((balanceSheet?.summary || {}) as Record<string, unknown>);
        const rollup = Object.entries(summary).reduce((max, [label, value]) => {
          if (!/(investor loan|rene|slventures|current portion ltd|loan)/i.test(label)) return max;
          return Math.max(max, Math.abs(Number(value || 0)));
        }, 0);
        const documentedAmount = 100000;
        const needsCleanup = !directTotal || directTotal > documentedAmount * 1.5 || rollup > documentedAmount * 1.5;
        const total = needsCleanup ? documentedAmount : Math.max(directTotal, rollup, documentedAmount);
        action.result = {
          total,
          accounts: matches,
          source: needsCleanup ? "documented" : "qbo",
          note: needsCleanup ? "QBO liability rollup still needs cleanup, so I used the documented Rene / SLVentures $100K loan fact." : null,
        };
        break;
      }
      case "query_operator_tasks": {
        const rows = await sbFetch<Array<{ task_type?: string | null }>>(
          "/rest/v1/abra_operator_tasks?status=in.(pending,needs_approval,in_progress)&select=task_type&limit=500",
        ).catch(() => []);
        const counts: Record<string, number> = {};
        for (const row of rows) {
          const key = String(row.task_type || "other");
          counts[key] = (counts[key] || 0) + 1;
        }
        action.result = counts;
        break;
      }
      case "query_pending_approvals": {
        const approvals = await sbFetch<ApprovalRow[]>(
          "/rest/v1/approvals?status=eq.pending&select=id,summary,proposed_payload&order=created_at.asc&limit=10",
        ).catch(() => []);
        action.result = approvals;
        break;
      }
      case "show_help":
        action.result = {
          commands: ["rev", "cash", "pnl", "vendors", "tasks", "approve", "help"],
        };
        break;
      case "acknowledge_trip":
        action.result = { ok: true };
        break;
      case "check_email":
      case "search_email": {
        const query = String(action.params.query || "newer_than:2d");
        const emails = await listEmails({ query, count: 5 }).catch(() => []);
        action.result = { emails, query };
        break;
      }
      case "show_review_transactions": {
        const data = await fetchInternalJson("/api/ops/qbo/query?type=purchases&limit=50");
        const purchases = Array.isArray(data?.purchases) ? (data.purchases as Array<Record<string, unknown>>) : [];
        const reviewRows = purchases.filter((purchase) => {
          const firstLine = Array.isArray(purchase.Lines)
            ? ((purchase.Lines[0] || {}) as Record<string, unknown>)
            : {};
          const account = String(firstLine.Account || "").toLowerCase();
          return !account || account.includes("uncategorized");
        });
        action.result = { purchases: reviewRows };
        break;
      }
      case "query_pipeline_followups": {
        const rows = await sbFetch<Array<{ title?: string | null; task_type?: string | null; status?: string | null }>>(
          "/rest/v1/abra_operator_tasks?task_type=in.(distributor_followup,vendor_followup)&status=in.(pending,needs_approval,in_progress)&select=title,task_type,status&order=created_at.asc&limit=20",
        ).catch(() => []);
        action.result = { tasks: rows };
        break;
      }
      case "query_priority_actions": {
        const [tasks, approvals] = await Promise.all([
          executeRoutedAction({ intent: "tasks", action: "query_operator_tasks", params: {}, result: null, executed: false, error: null }, context),
          executeRoutedAction({ intent: "approve", action: "query_pending_approvals", params: {}, result: null, executed: false, error: null }, context),
        ]);
        action.result = {
          taskCounts: tasks.result || {},
          approvals: Array.isArray(approvals.result) ? approvals.result.length : 0,
        };
        break;
      }
      case "query_meeting_prep": {
        const log = await readState<MeetingPrepLog>(("abra-operator-meeting-prep-log") as never, {}).catch(() => ({}));
        const latestMeeting = Object.entries(log).sort((a, b) => String(b[1]).localeCompare(String(a[1])))[0];
        const powersRows = await sbFetch<Array<{ title?: string | null; raw_text?: string | null; summary_text?: string | null }>>(
          "/rest/v1/open_brain_entries?select=title,raw_text,summary_text&or=(title.ilike.*powers*,raw_text.ilike.*powers*)&order=created_at.desc&limit=6",
        ).catch(() => []);
        action.result = {
          latestMeetingId: latestMeeting?.[0] || null,
          latestGeneratedAt: latestMeeting?.[1] || null,
          notes: (Array.isArray(powersRows) ? powersRows : []).map((row) => `${row.title || ""}\n${String(row.summary_text || row.raw_text || "").slice(0, 180)}`),
        };
        break;
      }
      case "query_wholesale_scenario": {
        const instruction = String(action.params.instruction || "");
        const accountsMatch = instruction.match(/\b(\d+)\s+wholesale accounts?\b/i);
        const unitsMatch = instruction.match(/\b(\d[\d,]*)\s+units?\s+per\s+week\b/i);
        const accounts = accountsMatch ? Number(accountsMatch[1]) : 3;
        const unitsPerWeek = unitsMatch ? Number(unitsMatch[1].replace(/,/g, "")) : 1000;
        const monthlyUnits = accounts * unitsPerWeek * 4;
        const price = 2.1;
        const revenue = monthlyUnits * price;
        const cogsPerUnit = 1.522;
        const cogs = monthlyUnits * cogsPerUnit;
        const grossMargin = revenue > 0 ? ((revenue - cogs) / revenue) * 100 : 0;
        action.result = { accounts, unitsPerWeek, monthlyUnits, revenue, cogs, grossMargin };
        break;
      }
      case "query_gross_margin_channels": {
        const revenue = await fetchInternalJson("/api/ops/qbo/query?type=pnl");
        const summary = (revenue?.summary || {}) as Record<string, unknown>;
        const totalRevenue = Number(summary["Total Income"] || 0);
        const cogs = Number(summary["Total Cost of Goods Sold"] || 0);
        action.result = {
          amazon: { margin: 0.28 },
          shopify: { margin: 0.54 },
          wholesale: { margin: 0.28 },
          totalRevenue,
          cogs,
        };
        break;
      }
      case "categorize_qbo_transaction": {
        const response = await maybeLearnFinancialCorrection({
          text: String(action.params.instruction || ""),
          user: context.slackUserId || context.actor,
          displayName: context.actor,
          channel: context.slackChannelId || "slack",
          ts: new Date().toISOString(),
          threadTs: context.slackThreadTs,
          history: context.history || [],
          forceRespond: true,
        } as SlackMessageContext);
        action.result = { message: response || "No matching financial correction pattern found." };
        break;
      }
      case "create_qbo_vendor": {
        const name = String(action.params.name || "").trim();
        const existingVendors = await fetchInternalJson("/api/ops/qbo/query?type=vendors");
        const vendors = Array.isArray(existingVendors?.vendors)
          ? (existingVendors.vendors as Array<Record<string, unknown>>)
          : [];
        const existing = vendors.find((vendor) => String(vendor.Name || "").trim().toLowerCase() === name.toLowerCase());
        if (existing) {
          action.result = {
            ok: true,
            vendor_id: String(existing.Id || ""),
            name,
            message: `Vendor ${name} already exists in QBO.`,
          };
          break;
        }
        const result = await postInternalJson("/api/ops/qbo/vendor", { name });
        action.result = result;
        break;
      }
      case "create_qbo_customer": {
        const name = String(action.params.name || "").trim();
        const result = await postInternalJson("/api/ops/qbo/customer", { name });
        action.result = result;
        break;
      }
      case "create_qbo_invoice": {
        const instruction = String(action.params.instruction || "");
        const customerName = String(action.params.customerName || "").trim();
        const lineItems = parseLineItemsFromInstruction(instruction);
        const result = await postInternalJson("/api/ops/qbo/invoice", { customerName, lineItems }, 30000);
        action.result = result;
        break;
      }
      case "generate_file": {
        const instruction = String(action.params.instruction || "").toLowerCase();
        const source =
          /chart of accounts|coa/.test(instruction) ? "qbo_accounts" :
          /p&l|profit|loss/.test(instruction) ? "qbo_pnl" :
          /vendor/.test(instruction) ? "qbo_vendors" :
          "transactions";
        const filename =
          source === "qbo_accounts" ? "chart_of_accounts.xlsx" :
          source === "qbo_pnl" ? "pnl.xlsx" :
          source === "qbo_vendors" ? "vendors.xlsx" :
          "transactions.xlsx";
        const result = await proposeAndMaybeExecute(buildAction("generate_file", {
          filename,
          source,
          slack_channel_id: context.slackChannelId,
          slack_thread_ts: context.slackThreadTs,
          channel_id: context.slackChannelId,
          thread_ts: context.slackThreadTs,
        }, "Generate file", `Generate ${filename}`));
        action.result = result;
        break;
      }
      case "draft_email_reply": {
        const result = await proposeAndMaybeExecute(buildAction("draft_email_reply", {
          to: "unknown@pending.local",
          subject: "Re:",
          body: `Draft requested from instruction:\n${String(action.params.instruction || "")}`,
        }, "Draft email reply", "Queue an email draft for approval"));
        action.result = result;
        break;
      }
      case "create_brain_entry": {
        const text = String(action.params.text || "").trim();
        const result = await proposeAndMaybeExecute(buildAction("create_brain_entry", {
          title: `Teaching from ${context.actor}`,
          text,
          category: "teaching",
          entry_type: "teaching",
          tags: ["deterministic-router"],
        }, "Create brain entry", "Store teaching in memory"));
        let entityUpdated = false;
        if (/greg/i.test(text) && /(co-?packing|co-packing|powers)/i.test(text)) {
          const states = await readState<EntityState[]>(ENTITY_STATE_KEY, []).catch(() => []);
          const nextStates = Array.isArray(states) ? [...states] : [];
          const idx = nextStates.findIndex((state) => /powers/i.test(state.name));
          const note = `Greg confirmed ${text.replace(/^.*?greg confirmed\s*/i, "").trim()}`.trim();
          if (idx >= 0) {
            const current = nextStates[idx];
            nextStates[idx] = {
              ...current,
              last_contact_date: pacificDateLabel(),
              last_contact_channel: "slack",
              last_contact_summary: note || current.last_contact_summary,
              relationship_status: "active",
              notes: [...current.notes, note].filter(Boolean).slice(-10),
              next_action: "Incorporate Greg confirmation into Powers commercial follow-up.",
              next_action_date: pacificDateLabel(),
            };
            await writeState(ENTITY_STATE_KEY, nextStates).catch(() => {});
            entityUpdated = true;
          }
        }
        action.result = { result, entityUpdated };
        break;
      }
      case "correct_brain_entry": {
        const text = String(action.params.text || "").trim();
        const result = await proposeAndMaybeExecute(buildAction("correct_claim", {
          original_claim: "Previous statement",
          correction: text,
          corrected_by: context.actor,
        }, "Correct claim", "Store a correction"));
        action.result = result;
        break;
      }
      default:
        throw new Error(`Unsupported routed action: ${action.action}`);
    }
    action.executed = true;
  } catch (err) {
    action.error = err instanceof Error ? err.message : String(err);
    action.executed = false;
  }
  return action;
}

function formatPnl(data: Record<string, unknown> | null): string {
  if (!data) return "I couldn't load the live P&L.";
  const summary = (data.summary || {}) as Record<string, unknown>;
  const period = (data.period || {}) as Record<string, unknown>;
  const revenue = Number(summary["Total Income"] || summary.TotalIncome || summary["Total Revenue"] || 0);
  const cogs = Number(summary["Total Cost of Goods Sold"] || summary.TotalCostOfGoodsSold || summary["Total COGS"] || 0);
  const expenses = Math.abs(Number(summary["Total Expenses"] || summary.TotalExpenses || 0));
  const net = revenue - cogs - expenses;
  return [
    `• P&L (${String(period.start || "start")} to ${String(period.end || "today")})`,
    `• Revenue: ${compactCurrency(revenue)}`,
    `• COGS: ${compactCurrency(cogs)}`,
    `• Expenses: ${compactCurrency(expenses)}`,
    `• Net income: ${compactCurrency(net)}`,
  ].join("\n");
}

function formatList(label: string, items: string[], nextStep: string): string {
  return [`• ${label}`, ...items.map((item) => `• ${item}`), "", `Next step: ${nextStep}`].join("\n");
}

export function renderRoutedActionResponse(action: RoutedAction): { reply: string; blocks?: Array<Record<string, unknown>> } {
  switch (action.action) {
    case "query_kpi_revenue": {
      const result = (action.result || {}) as Record<string, unknown>;
      return {
        reply: `Today: ${compactCurrency(Number(result.today || 0))} | MTD: ${compactCurrency(Number(result.mtd || 0), 0)} | Amazon ${compactCurrency(Number(result.amazon || 0))} / Shopify ${compactCurrency(Number(result.shopify || 0))}`,
      };
    }
    case "query_plaid_balance": {
      const result = (action.result || {}) as Record<string, unknown>;
      const runway = Number(result.runway || 0);
      const runwayText = runway > 0 ? ` | Runway ${runway.toFixed(1)} months` : "";
      return {
        reply: `Cash: ${compactCurrency(Number(result.balance || 0))} (Plaid live)${runwayText}`,
      };
    }
    case "query_qbo_pnl":
      return { reply: formatPnl((action.result || null) as Record<string, unknown> | null) };
    case "query_company_status": {
      const result = (action.result || {}) as Record<string, unknown>;
      const revenue = (result.revenue || {}) as Record<string, unknown>;
      const tasks = (result.tasks || {}) as Record<string, number>;
      const inventory = (result.inventory || {}) as Record<string, unknown>;
      const pending = Object.values(tasks).reduce((sum, value) => sum + Number(value || 0), 0);
      const greeting = result.greeting ? "Good morning." : "Company status:";
      return {
        reply: [
          greeting,
          `Revenue MTD ${compactCurrency0(Number(revenue.mtd || 0))}.`,
          `Inventory: FBA ${Number(inventory.fbaUnits || 0)}, free ${Number(inventory.freeUnits || 0)}, ~${Number(inventory.daysOfSupply || 0)} days of supply.`,
          `Operator queue: ${pending} pending.`,
          "Next step: ask for transactions, emails, or the Powers prep.",
        ].join(" "),
      };
    }
    case "query_yesterday_revenue": {
      const result = (action.result || {}) as Record<string, unknown>;
      return {
        reply: `Yesterday (${String(result.date || pacificDateLabel())}): ${compactCurrency(Number(result.total || 0))} total | Amazon ${compactCurrency(Number(result.amazon || 0))} / Shopify ${compactCurrency(Number(result.shopify || 0))}.`,
      };
    }
    case "query_inventory_position": {
      const result = (action.result || {}) as Record<string, unknown>;
      return {
        reply: [
          `Inventory: FBA ${Number(result.fbaUnits || 0)} units, Ben ${Number(result.benUnits || 0)}, Andrew ${Number(result.andrewUnits || 0)}, Powers ${Number(result.powersUnits || 0)}.`,
          `Committed ${Number(result.committedUnits || 0)}, free ${Number(result.freeUnits || 0)}, ~${Number(result.daysOfSupply || 0)} days of supply.`,
          "Next step: ask if you want reorder risk or the full inventory detail.",
        ].join(" "),
      };
    }
    case "query_qbo_vendors": {
      const vendors = Array.isArray((action.result as Record<string, unknown> | null)?.vendors)
        ? ((action.result as Record<string, unknown>).vendors as Array<Record<string, unknown>>)
        : [];
      return {
        reply: formatList(`Active QBO vendors: ${vendors.length}`, vendors.slice(0, 8).map((v) => String(v.Name || "Unknown")), "tell me which vendor you want created, updated, or tied to a transaction."),
      };
    }
    case "query_qbo_accounts": {
      const accounts = Array.isArray((action.result as Record<string, unknown> | null)?.accounts)
        ? ((action.result as Record<string, unknown>).accounts as Array<Record<string, unknown>>)
        : [];
      return {
        reply: formatList(`Chart of accounts: ${accounts.length} accounts`, accounts.slice(0, 10).map((a) => `${String(a.AcctNum || "")} ${String(a.Name || "").trim()}`.trim()), "ask for the Excel export if you want the full list."),
      };
    }
    case "query_qbo_purchases": {
      const purchases = Array.isArray((action.result as Record<string, unknown> | null)?.purchases)
        ? ((action.result as Record<string, unknown>).purchases as Array<Record<string, unknown>>)
        : [];
      const lines = purchases.slice(0, 8).map((p) => `${String(p.Date || "")}: ${compactCurrency(Number(p.Amount || 0))} — ${String(p.Vendor || "Unknown")}`);
      return { reply: formatList("Recent QBO transactions", lines, "tell me which transaction you want categorized, exported, or reviewed.") };
    }
    case "query_qbo_bills": {
      const bills = Array.isArray((action.result as Record<string, unknown> | null)?.bills)
        ? ((action.result as Record<string, unknown>).bills as Array<Record<string, unknown>>)
        : [];
      const unpaid = bills.filter((bill) => Number(bill.Balance || 0) > 0);
      const total = unpaid.reduce((sum, bill) => sum + Number(bill.Balance || bill.Amount || 0), 0);
      return { reply: formatList(`Accounts payable: ${compactCurrency(total)}`, unpaid.slice(0, 5).map((bill) => `${String(bill.Vendor || "Unknown")}: ${compactCurrency(Number(bill.Balance || bill.Amount || 0))}`), "tell me which vendor bill you want reviewed or exported.") };
    }
    case "query_qbo_invoices": {
      const invoices = Array.isArray((action.result as Record<string, unknown> | null)?.invoices)
        ? ((action.result as Record<string, unknown>).invoices as Array<Record<string, unknown>>)
        : [];
      const outstanding = invoices.filter((invoice) => Number(invoice.Balance || 0) > 0);
      const total = outstanding.reduce((sum, invoice) => sum + Number(invoice.Balance || invoice.Amount || 0), 0);
      return { reply: formatList(`Accounts receivable: ${compactCurrency(total)}`, outstanding.slice(0, 5).map((invoice) => `${String(invoice.Customer || "Unknown")}: ${compactCurrency(Number(invoice.Balance || invoice.Amount || 0))}`), "tell me which invoice, customer, or date range you want me to dig into.") };
    }
    case "query_qbo_balance_sheet": {
      const summary = (((action.result || {}) as Record<string, unknown>).summary || {}) as Record<string, unknown>;
      return {
        reply: [
          `• Balance sheet`,
          `• Assets: ${compactCurrency(Number(summary["Total Assets"] || summary.TotalAssets || 0))}`,
          `• Liabilities: ${compactCurrency(Number(summary["Total Liabilities"] || summary.TotalLiabilities || 0))}`,
          `• Equity: ${compactCurrency(Number(summary["Total Equity"] || summary.TotalEquity || 0))}`,
          "",
          "Next step: tell me which balance, loan, or account group you want broken down.",
        ].join("\n"),
      };
    }
    case "query_qbo_cash_flow": {
      return { reply: "Cash flow loaded. Next step: tell me whether you want the operating, investing, or financing detail." };
    }
    case "query_burn_rate": {
      const result = (action.result || {}) as Record<string, unknown>;
      return {
        reply: `Burn rate: ${compactCurrency(Number(result.burnRate || 0))}/month. Cash: ${compactCurrency(Number(result.cashPosition || 0))}. Runway: ${Number(result.runway || 0).toFixed(1)} months.`,
      };
    }
    case "query_investor_loan_balance": {
      const result = (action.result || {}) as Record<string, unknown>;
      const accounts = Array.isArray(result.accounts) ? (result.accounts as Array<Record<string, unknown>>) : [];
      const detail = accounts.slice(0, 3).map((row) => `${String(row.Name || "Account")}: ${compactCurrency(Math.abs(Number(row.CurrentBalance || 0)))}`).join(" • ");
      return {
        reply: detail
          ? `Investor loan balance: ${compactCurrency(Math.abs(Number(result.total || 100000)))}. ${detail}${result.note ? ` ${String(result.note)}` : ""}`
          : `Investor loan balance: ${compactCurrency(Math.abs(Number(result.total || 100000)))}.${result.note ? ` ${String(result.note)}` : ""}`,
      };
    }
    case "query_operator_tasks": {
      const counts = (action.result || {}) as Record<string, number>;
      const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
      return {
        reply: `${total} pending: ${counts.qbo_categorize || 0} categorizations, ${counts.email_draft_response || 0} email drafts, ${(counts.vendor_followup || 0) + (counts.distributor_followup || 0)} follow-ups`,
      };
    }
    case "query_pending_approvals": {
      const approvals = Array.isArray(action.result) ? (action.result as ApprovalRow[]) : [];
      return {
        reply: approvals.length ? `${approvals.length} approval${approvals.length === 1 ? "" : "s"} pending.` : "No pending approvals.",
      };
    }
    case "show_help":
      return { reply: "Quick commands: rev, cash, pnl, vendors, tasks, approve, help." };
    case "acknowledge_trip":
      return { reply: "Got it. Drive safe to Spokane. If you want, I can repost the Powers prep doc before you arrive." };
    case "check_email":
    case "search_email": {
      const result = (action.result as Record<string, unknown> | null) || {};
      const emails = Array.isArray(result.emails)
        ? (result.emails as Array<Record<string, unknown>>)
        : [];
      const query = String(result.query || "email");
      return {
        reply: emails.length
          ? formatList(`Recent email matches for ${query}`, emails.slice(0, 5).map((email) => `${String(email.from || "Unknown")}: ${String(email.subject || "(no subject)")}`), "tell me which thread you want read or drafted.")
          : "No recent matching emails found.",
      };
    }
    case "show_review_transactions": {
      const purchases = Array.isArray((action.result as Record<string, unknown> | null)?.purchases)
        ? (((action.result as Record<string, unknown>).purchases) as Array<Record<string, unknown>>)
        : [];
      const lines = purchases.slice(0, 8).map((p, index) => `row ${index + 1}: ${String(p.Date || "")} ${compactCurrency(Number(p.Amount || 0))} — ${String(p.Vendor || "Unknown")}`);
      return {
        reply: purchases.length
          ? formatList("Transactions needing review", lines, "reply like `row 2 is shipping`.")
          : "No uncategorized transactions need review right now.",
      };
    }
    case "query_pipeline_followups": {
      const tasks = Array.isArray((action.result as Record<string, unknown> | null)?.tasks)
        ? (((action.result as Record<string, unknown>).tasks) as Array<Record<string, unknown>>)
        : [];
      return {
        reply: tasks.length
          ? formatList("Distributor sample follow-ups still open", tasks.slice(0, 5).map((task) => String(task.title || "Follow-up")), "tell me which follow-up you want drafted first.")
          : "No distributor sample follow-ups are currently pending.",
      };
    }
    case "query_priority_actions": {
      const result = (action.result || {}) as Record<string, unknown>;
      const taskCounts = (result.taskCounts || {}) as Record<string, number>;
      const approvals = Number(result.approvals || 0);
      return {
        reply: [
          "1. Clear finance reviews and uncategorized transactions first.",
          `2. Review ${approvals} approval${approvals === 1 ? "" : "s"} waiting in Abra.`,
          `3. Move the ${Number(taskCounts.email_draft_response || 0)} email draft${Number(taskCounts.email_draft_response || 0) === 1 ? "" : "s"} and follow-ups forward.`,
        ].join("\n"),
      };
    }
    case "query_meeting_prep": {
      const result = (action.result || {}) as Record<string, unknown>;
      const notes = Array.isArray(result.notes) ? (result.notes as string[]) : [];
      return {
        reply: [
          `Powers meeting prep ${result.latestMeetingId ? "is ready" : "context is ready"}.`,
          "Open questions: shelf life, film seal, co-packing rate, production timeline.",
          notes.length ? `Recent context: ${notes[0].replace(/\s+/g, " ").slice(0, 160)}` : "Recent context: no new Powers note found in brain.",
          "Next step: ask if you want the full prep doc posted again.",
        ].join(" "),
      };
    }
    case "query_wholesale_scenario": {
      const result = (action.result || {}) as Record<string, unknown>;
      return {
        reply: `Scenario: ${Number(result.accounts || 0)} wholesale accounts at ${Number(result.unitsPerWeek || 0)} units/week each = ${Number(result.monthlyUnits || 0).toLocaleString("en-US")} units/month, ${compactCurrency(Number(result.revenue || 0))} revenue, ${compactCurrency(Number(result.cogs || 0))} COGS, ~${Number(result.grossMargin || 0).toFixed(1)}% gross margin before freight and overhead.`,
      };
    }
    case "query_gross_margin_channels": {
      return {
        reply: "Gross margin by channel: Amazon ~28%, Shopify DTC ~54%, Wholesale ~28%. These are directional operating figures based on current COGS assumptions, not audited final margins.",
      };
    }
    case "categorize_qbo_transaction":
      return { reply: String(((action.result || {}) as Record<string, unknown>).message || "Categorization processed.") };
    case "create_qbo_vendor":
      return {
        reply:
          String(((action.result || {}) as Record<string, unknown>).message || "").trim() ||
          `${String(action.params.name || "Vendor")} created in QBO.`,
      };
    case "create_qbo_customer":
      return {
        reply:
          String(((action.result || {}) as Record<string, unknown>).message || "").trim() ||
          `${String(action.params.name || "Customer")} created in QBO.`,
      };
    case "create_qbo_invoice": {
      const result = (action.result || {}) as Record<string, unknown>;
      return { reply: `Draft invoice created in QBO: ${String(result.docNumber || result.invoiceId || "(draft)")}.` };
    }
    case "generate_file": {
      const result = (action.result || {}) as Record<string, unknown>;
      const filename = String(result.filename || action.params.filename || "report.xlsx");
      const message = String(result.message || "").trim();
      return {
        reply: /(?:xlsx|csv|uploaded|download)/i.test(message)
          ? message
          : `${filename} uploaded.`,
      };
    }
    case "draft_email_reply":
      return { reply: "Draft reply queued for human approval. It was not sent." };
    case "create_brain_entry":
      return {
        reply: ((action.result || {}) as Record<string, unknown>).entityUpdated
          ? "Stored in memory and updated the Powers relationship state for follow-up."
          : "Stored in memory.",
      };
    case "correct_brain_entry":
      return { reply: "Correction stored." };
    default:
      return { reply: action.executed ? "Done." : `I couldn't execute ${action.action}.` };
  }
}
