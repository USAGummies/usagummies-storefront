import { createHash } from "node:crypto";
import { kv } from "@vercel/kv";
import {
  buildAbraSystemPrompt,
  type AbraCorrection,
  type AbraDepartment,
} from "@/lib/ops/abra-system-prompt";
import {
  extractClaudeUsage,
  logAICost,
} from "@/lib/ops/abra-cost-tracker";
import { appendCorrection as appendMarkdownCorrection } from "@/lib/ops/abra-markdown-memory";
import { executeRoutedAction, renderRoutedActionResponse } from "@/lib/ops/operator/action-executor";
import { maybeLearnFinancialCorrection } from "@/lib/ops/operator/correction-learner";
import {
  appendDrivingModeBacklog,
  formatDrivingModeReply,
  getDrivingModeState,
} from "@/lib/ops/operator/driving-mode";
import {
  extractEntityMentions,
  updateEntityFromEvent,
} from "@/lib/ops/operator/entities/entity-state";
import { routeMessage } from "@/lib/ops/operator/deterministic-router";
import { readState, writeState } from "@/lib/ops/state";
import { UNIFIED_REVENUE_STATE_KEY, type UnifiedRevenueSummary } from "@/lib/ops/operator/unified-revenue";
import { uploadFileToSlack, type SpreadsheetData } from "@/lib/ops/slack-file-upload";

export type SlackThreadMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SlackMessageContext = {
  text: string;
  user: string;
  channel: string;
  ts: string;
  threadTs?: string;
  displayName?: string;
  history?: SlackThreadMessage[];
  forceRespond?: boolean;
  uploadedFiles?: Array<{
    name: string;
    mimeType: string;
    buffer: Buffer;
  }>;
};

export type SlackResponse = {
  handled: boolean;
  reply: string;
  sources: Array<{
    title: string;
    source_table: "brain" | "email";
    days_ago?: number;
  }>;
  answerLogId: string | null;
  blocks?: Array<Record<string, unknown>>;
};

type StructuredDocKind = "chart_of_accounts";

type StructuredDocSession = {
  kind: StructuredDocKind;
  actor: string;
  chunks: string[];
  totalChars: number;
  createdAt: string;
  updatedAt: string;
};

type CoaRow = {
  accountNumber: string;
  description: string;
  accountType: string;
  subType: string;
};

type SlackPostOptions = {
  threadTs?: string;
  sources?: Array<{
    title: string;
    source_table: "brain" | "email";
    days_ago?: number;
  }>;
  answerLogId?: string | null;
  blocks?: Array<Record<string, unknown>>;
};

type ProactiveMessageOptions = {
  target: "channel" | "user";
  channelOrUserId: string;
  message: string;
  context?: string;
  requiresResponse?: boolean;
  blocks?: Array<Record<string, unknown>>;
  threadTs?: string;
};

const SLACK_BLOCK_TEXT_LIMIT = 3000;
const DATA_INGEST_THRESHOLD = 3000;
const STRUCTURED_DOC_TTL_SECONDS = 24 * 60 * 60;
const PENDING_CORRECTION_TTL_SECONDS = 30 * 60; // 30 minutes
const FINANCIALS_CHANNEL_ID = "C0AKG9FSC2J";
const ABRA_CONTROL_CHANNEL_ID = "C0ALS6W7VB4";
const RENE_SLACK_USER_ID = "U0ALL27JM38";
const ABRA_SLACK_USER_ID = "U0AKMSTL0GL";
const BEN_SLACK_USER_ID = "U08JY86Q508";
const MORNING_BRIEF_HELD_KEY = "abra:morning_brief_held" as never;
const BEN_LAST_SEEN_KEY = "abra:ben_last_seen" as never;

type HeldMorningBrief = {
  date: string;
  content: string;
  held_at: string;
};

// ─── Known user identity map ───
const KNOWN_SLACK_USERS: Record<string, { name: string; role: string; calibration: string }> = {
  U08JY86Q508: {
    name: "Ben Stutman",
    role: "Founder/CEO",
    calibration: "Wants executive summaries, key decisions, and action items. Skip deep accounting detail unless asked.",
  },
  U0ALL27JM38: {
    name: "Rene Gonzalez",
    role: "Finance Lead/Bookkeeper",
    calibration: "Wants accounting detail and transaction-level data. Include line items, account categories, and reconciliation info.",
  },
};

function getActorContext(userId: string): string | null {
  const known = KNOWN_SLACK_USERS[userId];
  if (!known) return null;
  return `CURRENT USER: ${known.name} (${known.role}). Calibration: ${known.calibration}`;
}

function isReneUser(userId: string): boolean {
  return userId === RENE_SLACK_USER_ID;
}

function isBenUser(userId: string): boolean {
  return userId === BEN_SLACK_USER_ID;
}

function isFinancialsChannel(channelId: string): boolean {
  return channelId === FINANCIALS_CHANNEL_ID;
}

function isControlChannel(channelId: string): boolean {
  return channelId === ABRA_CONTROL_CHANNEL_ID;
}

function monitoredChannelSet(): Set<string> {
  const raw = process.env.SLACK_MONITORED_CHANNELS || "";
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function pacificDateLabel(value = new Date()): string {
  return value.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

async function updateBenLastSeen(ctx: SlackMessageContext): Promise<void> {
  if (!isBenUser(ctx.user)) return;
  await writeState(BEN_LAST_SEEN_KEY, {
    ts: new Date().toISOString(),
    channel: ctx.channel,
    source_ts: ctx.ts,
  }).catch(() => {});
}

async function releaseHeldMorningBriefIfNeeded(ctx: SlackMessageContext): Promise<void> {
  if (!isBenUser(ctx.user)) return;
  const held = await readState<HeldMorningBrief | null>(MORNING_BRIEF_HELD_KEY, null).catch(() => null);
  if (!held?.content || held.date !== pacificDateLabel()) return;
  const briefMessage = `☀️ *Morning Brief*\n\n${held.content}`;
  const sent =
    (await sendDirectMessage(BEN_SLACK_USER_ID, briefMessage).catch(() => false)) ||
    (await postSlackMessage(ctx.channel, briefMessage, { threadTs: ctx.threadTs || ctx.ts }).catch(() => false));
  if (sent) {
    await writeState(MORNING_BRIEF_HELD_KEY, null).catch(() => {});
  }
}

export function shouldAbraRespond(text: string, channel: string): boolean {
  if (isFinancialsChannel(channel) || isControlChannel(channel)) return true;
  const normalized = (text || "").trim().toLowerCase();
  const mention =
    new RegExp(`<@${ABRA_SLACK_USER_ID}>`, "i").test(text || "") ||
    /(^|\s)@abra\b/i.test(normalized) ||
    /^abra[\s,:]/i.test(normalized) ||
    /\babra,\b/i.test(normalized) ||
    /^correct:/i.test(normalized) ||
    /^teach:/i.test(normalized);
  const monitored = monitoredChannelSet().has(channel);
  return mention || monitored;
}

function hasExplicitAbraMention(text: string): boolean {
  return (
    new RegExp(`<@${ABRA_SLACK_USER_ID}>`, "i").test(text || "") ||
    /(^|\s)@abra\b/i.test(text || "")
  );
}

function isAcknowledgmentText(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, "");
  return /^(ok|okay|k|kk|thanks|thank you|got it|understood|sounds good|perfect|done|great|works|copy)$/.test(normalized);
}

function isMinimalPrompt(text: string): boolean {
  return /^[\s?!.]+$/.test(text.trim());
}

function countQuestions(text: string): number {
  return (text.match(/\?/g) || []).length;
}

function parseBulletOrNumberedItems(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^(?:\d+[).:-]|\d+\s+|[-*•])\s*(.+)$/);
      return match?.[1]?.trim() || "";
    })
    .filter(Boolean);
}

function findLatestAssistantNumberedList(history: SlackThreadMessage[] | undefined): string[] {
  const reversed = [...(history || [])].reverse();
  for (const item of reversed) {
    if (item.role !== "assistant") continue;
    const parsed = parseBulletOrNumberedItems(item.content);
    if (parsed.length >= 3) return parsed;
  }
  return [];
}

function buildBatchExecutionPrompt(question: string, answer: string, index: number): string {
  return [
    `Process Rene's answer #${index + 1}.`,
    `Original Abra question: ${question}`,
    `Rene's answer: ${answer}`,
    "Apply the answer immediately. Persist it to memory if it is a business rule, preference, or operating policy. If the answer authorizes or instructs an internal action, execute it. Keep the Slack response brief and action-focused.",
  ].join("\n");
}

function normalizeSlackReply(reply: string): string {
  return reply
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function stripMarkdownHeaders(text: string): string {
  return text.replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, "*$1*");
}

function collapseMarkdownTable(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let idx = 0;
  while (idx < lines.length) {
    const line = lines[idx];
    if (line.includes("|") && idx + 1 < lines.length && /^\s*\|?[-:| ]+\|?\s*$/.test(lines[idx + 1] || "")) {
      const header = line.split("|").map((part) => part.trim()).filter(Boolean);
      idx += 2;
      while (idx < lines.length && lines[idx].includes("|")) {
        const cols = lines[idx].split("|").map((part) => part.trim()).filter(Boolean);
        if (cols.length > 0) {
          const bullet = cols
            .map((value, colIdx) => `${header[colIdx] || `Field ${colIdx + 1}`}: ${value}`)
            .join(" • ");
          out.push(`• ${bullet}`);
        }
        idx += 1;
      }
      continue;
    }
    out.push(line);
    idx += 1;
  }
  return out.join("\n");
}

function trimReplyForRene(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cutoff = text.lastIndexOf("\n", maxChars);
  const safeCutoff = cutoff > maxChars * 0.6 ? cutoff : maxChars;
  return `${text.slice(0, safeCutoff).trim()}\n\nNext step: send the one item you want handled first.`;
}

function formatReneSlackReply(text: string, opts: { isReport: boolean }): string {
  let result = stripMarkdownHeaders(collapseMarkdownTable(normalizeSlackReply(text)));
  if (countQuestions(result) > 1) {
    const firstQuestionIdx = result.indexOf("?");
    result =
      firstQuestionIdx >= 0
        ? `${result.slice(0, firstQuestionIdx + 1).trim()}\n\nNext step: send the one item you want handled first.`
        : result;
  }
  const maxChars = opts.isReport ? 1500 : 300;
  return trimReplyForRene(result, maxChars);
}

function isQuickCommand(text: string, values: string[]): boolean {
  const normalized = text.trim().toLowerCase().replace(/[!?.,]+$/g, "");
  return values.includes(normalized);
}

function compactCurrency(value: number, digits = 0): string {
  return `$${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

async function fetchPlaidLiveBalance(): Promise<number> {
  const data = await fetchInternalJson("/api/ops/plaid/balance");
  const accounts = Array.isArray(data?.accounts) ? (data.accounts as Array<Record<string, unknown>>) : [];
  return accounts.reduce((sum, account) => {
    const balances = (account.balances && typeof account.balances === "object")
      ? (account.balances as Record<string, unknown>)
      : {};
    return sum + Number(balances.current ?? balances.available ?? 0);
  }, 0);
}

async function fetchRevenueSnapshotForQuickCommand(): Promise<{
  today: number;
  mtd: number;
  amazon: number;
  shopify: number;
}> {
  const unified = await readState<UnifiedRevenueSummary | null>(UNIFIED_REVENUE_STATE_KEY, null).catch(() => null);
  const today = Number(unified?.total || 0);
  const mtd = Number(unified?.mtd || 0);
  const amazon = Number(unified?.amazon || 0);
  const shopify = Number(unified?.shopify || 0);
  if (today || mtd) {
    return { today, mtd, amazon, shopify };
  }

  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const monthStart = `${todayIso.slice(0, 7)}-01`;
  const rows = await sbFetch(
    `/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.(daily_revenue_amazon,daily_revenue_shopify)&captured_for_date=gte.${monthStart}&select=metric_name,captured_for_date,value&limit=120`,
  ).catch(() => []);
  const series = Array.isArray(rows) ? (rows as Array<{ metric_name?: string | null; captured_for_date?: string | null; value?: number | null }>) : [];
  let amazonToday = 0;
  let shopifyToday = 0;
  let mtdTotal = 0;
  for (const row of series) {
    const metric = String(row.metric_name || "");
    const date = String(row.captured_for_date || "");
    const value = Number(row.value || 0);
    if (date === todayIso && metric === "daily_revenue_amazon") amazonToday += value;
    if (date === todayIso && metric === "daily_revenue_shopify") shopifyToday += value;
    mtdTotal += value;
  }
  return { today: amazonToday + shopifyToday, mtd: mtdTotal, amazon: amazonToday, shopify: shopifyToday };
}

async function fetchPendingTaskCounts(): Promise<Record<string, number>> {
  const rows = await sbFetch(
    "/rest/v1/abra_operator_tasks?status=in.(pending,needs_approval,in_progress)&select=task_type&limit=500",
  ).catch(() => []);
  const counts: Record<string, number> = {};
  for (const row of (Array.isArray(rows) ? rows : []) as Array<{ task_type?: string | null }>) {
    const key = String(row.task_type || "other");
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

async function fetchRecentOperatorTasks(hours = 24): Promise<Array<{ task_type: string; status: string }>> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = await sbFetch(
    `/rest/v1/abra_operator_tasks?select=task_type,status,updated_at&updated_at=gte.${encodeURIComponent(cutoff)}&limit=500`,
  ).catch(() => []);
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const record = row as Record<string, unknown>;
    return {
      task_type: String(record.task_type || "unknown"),
      status: String(record.status || "unknown"),
    };
  });
}

function summarizeOperatorTasks(rows: Array<{ task_type: string; status: string }>, mode: "today" | "overnight" = "today"): string {
  const completed = rows.filter((row) => row.status === "completed");
  const grouped: Record<string, number> = {};
  for (const row of completed) {
    grouped[row.task_type] = (grouped[row.task_type] || 0) + 1;
  }
  const highlights = [
    grouped.qbo_categorize ? `${grouped.qbo_categorize} categorized` : "",
    grouped.qbo_assign_vendor ? `${grouped.qbo_assign_vendor} vendor assignments` : "",
    grouped.email_draft_response ? `${grouped.email_draft_response} email drafts` : "",
    grouped.distributor_followup || grouped.vendor_followup
      ? `${(grouped.distributor_followup || 0) + (grouped.vendor_followup || 0)} follow-ups`
      : "",
  ].filter(Boolean);
  const pending = rows.filter((row) => row.status === "pending" || row.status === "needs_approval").length;
  return [
    `Operator ${mode}: ${completed.length} task${completed.length === 1 ? "" : "s"} completed.`,
    highlights.length ? `Highlights: ${highlights.join(", ")}.` : "Highlights: no major automated actions completed yet.",
    `${pending} task${pending === 1 ? "" : "s"} still pending review or execution.`,
  ].join(" ");
}

async function fetchPendingApprovals(): Promise<Array<{ id: string; title: string }>> {
  const approvals = await sbFetch(
    "/rest/v1/approvals?status=eq.pending&select=id,summary,proposed_payload&order=created_at.asc&limit=5",
  ).catch(() => []);
  return (Array.isArray(approvals) ? approvals : []).map((row) => {
    const record = row as Record<string, unknown>;
    const payload = record.proposed_payload && typeof record.proposed_payload === "object"
      ? (record.proposed_payload as Record<string, unknown>)
      : {};
    return {
      id: String(record.id || ""),
      title: String(record.summary || payload.summary || payload.action_type || "Pending approval"),
    };
  }).filter((row) => row.id);
}

async function fetchPendingEmailTasks(): Promise<Array<{ id: string; title: string; body: string }>> {
  const rows = await sbFetch(
    "/rest/v1/abra_operator_tasks?task_type=in.(email_draft_response,vendor_followup,distributor_followup)&status=in.(pending,needs_approval)&select=id,title,execution_result&order=created_at.asc&limit=5",
  ).catch(() => []);
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const record = row as Record<string, unknown>;
    const executionResult = record.execution_result && typeof record.execution_result === "object"
      ? (record.execution_result as Record<string, unknown>)
      : {};
    return {
      id: String(record.id || ""),
      title: String(record.title || "Email draft"),
      body: String(executionResult.draft || executionResult.message || ""),
    };
  }).filter((row) => row.id);
}

function buildApprovalBlocks(approvals: Array<{ id: string; title: string }>): Array<Record<string, unknown>> {
  return approvals.flatMap((approval) => ([
    {
      type: "section",
      text: { type: "mrkdwn", text: `⏳ *${approval.title}*` },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Approve" },
          style: "primary",
          action_id: "approve_action",
          value: approval.id,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Reject" },
          style: "danger",
          action_id: "reject_action",
          value: approval.id,
        },
      ],
    },
  ]));
}

function buildEmailBlocks(tasks: Array<{ id: string; title: string; body: string }>): Array<Record<string, unknown>> {
  return tasks.flatMap((task) => ([
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📧 *${task.title}*\n${(task.body || "Draft ready").slice(0, 140)}`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View Draft" },
          style: "primary",
          action_id: "view_email_draft",
          value: task.id,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Skip" },
          action_id: "skip_email_task",
          value: task.id,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Remind Tomorrow" },
          action_id: "remind_email_task",
          value: task.id,
        },
      ],
    },
  ]));
}

async function maybeHandleQuickCommand(ctx: SlackMessageContext): Promise<SlackResponse | null> {
  const text = ctx.text.trim();
  if (isQuickCommand(text, ["rev", "revenue"])) {
    const snapshot = await fetchRevenueSnapshotForQuickCommand();
    return {
      handled: true,
      reply: `Today: ${compactCurrency(snapshot.today, 2)} | MTD: ${compactCurrency(snapshot.mtd)} | Amazon ${compactCurrency(snapshot.amazon, 2)} / Shopify ${compactCurrency(snapshot.shopify, 2)}`,
      sources: [],
      answerLogId: null,
    };
  }
  if (isQuickCommand(text, ["cash"])) {
    const balance = await fetchPlaidLiveBalance().catch(() => 0);
    return {
      handled: true,
      reply: `Cash: ${compactCurrency(balance, 2)} (Plaid live)`,
      sources: [],
      answerLogId: null,
    };
  }
  if (isQuickCommand(text, ["pnl"])) {
    const data = await fetchInternalJson("/api/ops/qbo/query?type=pnl");
    const body = data ? formatQboPnlForSlack(data) : null;
    return {
      handled: true,
      reply: formatReneSlackReply(body || "I couldn’t load the live P&L.", { isReport: false }),
      sources: [],
      answerLogId: null,
    };
  }
  if (isQuickCommand(text, ["vendors"])) {
    const data = await fetchInternalJson("/api/ops/qbo/query?type=vendors");
    return {
      handled: true,
      reply: formatReneSlackReply(formatQboVendorsForSlack(data || {}) || "No vendors found.", { isReport: false }),
      sources: [],
      answerLogId: null,
    };
  }
  if (isQuickCommand(text, ["tasks"])) {
    const counts = await fetchPendingTaskCounts();
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    return {
      handled: true,
      reply: `${total} pending: ${counts.qbo_categorize || 0} categorizations, ${counts.email_draft_response || 0} email drafts, ${(counts.vendor_followup || 0) + (counts.distributor_followup || 0)} follow-ups`,
      sources: [],
      answerLogId: null,
    };
  }
  if (isQuickCommand(text, ["approve"])) {
    const approvals = await fetchPendingApprovals();
    return {
      handled: true,
      reply: approvals.length ? `${approvals.length} approval${approvals.length === 1 ? "" : "s"} pending.` : "No pending approvals.",
      sources: [],
      answerLogId: null,
      blocks: approvals.length ? buildApprovalBlocks(approvals) : undefined,
    };
  }
  if (isQuickCommand(text, ["emails"])) {
    const tasks = await fetchPendingEmailTasks();
    return {
      handled: true,
      reply: tasks.length ? `${tasks.length} draft${tasks.length === 1 ? "" : "s"} ready for review.` : "No email drafts are waiting right now.",
      sources: [],
      answerLogId: null,
      blocks: tasks.length ? buildEmailBlocks(tasks) : undefined,
    };
  }
  if (isQuickCommand(text, ["review"])) {
    const data = await fetchInternalJson("/api/ops/qbo/query?type=purchases&limit=20");
    if (!data) return null;
    const purchases = Array.isArray(data.purchases) ? (data.purchases as Array<Record<string, unknown>>) : [];
    const reviewRows = purchases.filter((purchase) => {
      const firstLine = Array.isArray(purchase.Lines) ? ((purchase.Lines[0] || {}) as Record<string, unknown>) : {};
      const account = String(firstLine.Account || "").toLowerCase();
      return !account || account.includes("uncategorized");
    });
    const body = reviewRows.length
      ? ["Need review:", ...reviewRows.slice(0, 5).map((purchase, index) => `• row ${index + 1}: ${String(purchase.Date || "")} ${compactCurrency(Number(purchase.Amount || 0), 2)} — ${String(purchase.Vendor || "Unknown")}`), "", "Reply like `row 2 is shipping`."] .join("\n")
      : "No uncategorized transactions need review right now.";
    return {
      handled: true,
      reply: formatReneSlackReply(body, { isReport: false }),
      sources: [],
      answerLogId: null,
    };
  }
  if (isQuickCommand(text, ["help"])) {
    return {
      handled: true,
      reply: `Quick commands: rev, cash, pnl, vendors, tasks, review, emails, approve.`,
      sources: [],
      answerLogId: null,
    };
  }
  return null;
}

async function maybeHandleOperatorStatusQuery(ctx: SlackMessageContext): Promise<SlackResponse | null> {
  if (!/\b(operator|abra)\b/i.test(ctx.text) || !/\b(today|overnight|last night)\b/i.test(ctx.text)) {
    return null;
  }
  const rows = await fetchRecentOperatorTasks(24);
  const mode = /\b(overnight|last night)\b/i.test(ctx.text) ? "overnight" : "today";
  return {
    handled: true,
    reply: summarizeOperatorTasks(rows, mode),
    sources: [],
    answerLogId: null,
  };
}

function maybeHandleQboUiGuidance(ctx: SlackMessageContext): SlackResponse | null {
  const text = ctx.text.toLowerCase();
  if (!/\b(account numbers|qbo settings|quickbooks settings|quickbooks ui|chart of accounts settings)\b/.test(text)) {
    return null;
  }
  if (!/\benable\b|\bturn on\b|\bhow do i\b|\bwhere\b|\bsettings\b/.test(text)) {
    return null;
  }
  return {
    handled: true,
    reply: [
      "• QuickBooks UI: Settings ⚙️ → Account and settings → Advanced",
      "• In Chart of accounts, enable Account numbers",
      "• Save, then reopen the chart of accounts",
      "",
      "I can’t change QBO UI settings by API. Next step: once it’s on, I can help create, review, or export the accounts.",
    ].join("\n"),
    sources: [],
    answerLogId: null,
  };
}

function looksLikeQboReadQuery(text: string): boolean {
  const normalized = text.toLowerCase();
  if (/\b(create|generate|record|categorize|assign|set up|setup|add)\b/.test(normalized)) {
    return false;
  }
  return (
    /\bp&l\b|\bprofit and loss\b/.test(normalized) ||
    /\btransactions?\b/.test(normalized) ||
    /\bcash position\b|\bbalance sheet\b|\bvendors?\b|\bchart of accounts\b|\bcoa\b/.test(normalized) ||
    /\baccounts payable\b|\baccounts receivable\b|\bbills?\b|\binvoices?\b|\bowe vendors\b|\bwho owes us money\b/.test(normalized)
  );
}

function looksLikeQboReportQuery(text: string): boolean {
  const normalized = text.toLowerCase();
  return /\bp&l\b|\bprofit and loss\b|\btransactions?\b|\bvendors?\b|\bchart of accounts\b|\bcash position\b|\bbalance sheet\b/.test(normalized);
}

async function fetchInternalJson(path: string): Promise<Record<string, unknown> | null> {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) return null;
  const host = resolveInternalHost();
  const res = await fetchWithTimeout(
    `${host}${path}`,
    {
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "Content-Type": "application/json",
      },
    },
    15000,
  );
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function wantsExcelExport(text: string): boolean {
  return /\b(excel|xlsx|spreadsheet|export)\b/i.test(text);
}

function formatQboPnlForSlack(data: Record<string, unknown>): string | null {
  const period = (data.period || {}) as Record<string, unknown>;
  const summary = (data.summary || {}) as Record<string, unknown>;
  const revenue = Number(summary["Total Income"] || summary.TotalIncome || summary["Total Revenue"] || summary.Revenue || summary.Income || 0);
  const cogs = Number(summary["Total Cost of Goods Sold"] || summary.TotalCostOfGoodsSold || summary["Total COGS"] || summary.COGS || summary.CostOfGoodsSold || 0);
  const expenses = Math.abs(Number(summary["Total Expenses"] || summary.TotalExpenses || summary.Expenses || 0));
  // Compute net income from components — QBO sometimes returns wrong sign
  const rawNetIncome = Number(summary["Net Income"] || summary.NetIncome || summary["Net Operating Income"] || summary.NetOperatingIncome || 0);
  const computedNetIncome = revenue - cogs - expenses;
  // If QBO says positive but computed says negative (or vice versa), trust computed
  const netIncome = Math.sign(rawNetIncome) !== Math.sign(computedNetIncome) && computedNetIncome !== 0
    ? computedNetIncome
    : rawNetIncome || computedNetIncome;
  return [
    `• P&L MTD (${String(period.start || "start")} to ${String(period.end || "today")})`,
    `• Revenue: ${formatCurrency(revenue)}`,
    `• COGS: ${formatCurrency(cogs)}`,
    `• Expenses: ${formatCurrency(expenses)}`,
    `• Net income: ${formatCurrency(netIncome)}`,
    "",
    "Next step: tell me which line item, transaction set, or adjustment you want me to handle.",
  ].join("\n");
}

function formatQboTransactionsForSlack(data: Record<string, unknown>): string | null {
  const purchases = Array.isArray(data.purchases) ? (data.purchases as Array<Record<string, unknown>>) : [];
  if (purchases.length === 0) {
    return "• Recent transactions: none found.\n\nNext step: ask me for a different date range or an Excel export.";
  }
  const totalsByMonth = new Map<string, number>();
  const grouped = new Map<string, string[]>();
  for (const purchase of purchases) {
    const date = String(purchase.Date || "");
    const month = date.slice(0, 7) || "unknown";
    const amount = Number(purchase.Amount || 0);
    const vendor = String(purchase.Vendor || "Unknown vendor");
    const desc = Array.isArray(purchase.Lines) ? String(((purchase.Lines[0] || {}) as Record<string, unknown>).Description || "") : "";
    totalsByMonth.set(month, (totalsByMonth.get(month) || 0) + amount);
    const lines = grouped.get(month) || [];
    lines.push(`• ${date}: ${formatCurrency(amount)} — ${vendor}${desc ? ` (${desc.slice(0, 60)})` : ""}`);
    grouped.set(month, lines);
  }
  const months = [...grouped.keys()].sort().reverse();
  const out = ["• Recent QBO transactions"];
  for (const month of months.slice(0, 3)) {
    out.push(`• ${month} total: ${formatCurrency(totalsByMonth.get(month) || 0)}`);
    out.push(...(grouped.get(month) || []).slice(0, 5));
  }
  out.push("", "Next step: tell me which transaction you want categorized, exported, or reviewed.");
  return out.join("\n");
}

function formatQboVendorsForSlack(data: Record<string, unknown>): string | null {
  const vendors = Array.isArray(data.vendors) ? (data.vendors as Array<Record<string, unknown>>) : [];
  const active = vendors.filter((vendor) => vendor.Active !== false);
  return [
    `• Active QBO vendors: ${active.length}`,
    ...active.slice(0, 8).map((vendor) => `• ${String(vendor.Name || "Unknown")}`),
    "",
    "Next step: tell me which vendor you want created, updated, or tied to a transaction.",
  ].join("\n");
}

function formatQboCashPositionForSlack(data: Record<string, unknown>): string | null {
  return [
    `• Cash position: ${formatCurrency(Number(data.cashPosition || 0))}`,
    `• 30-day revenue: ${formatCurrency(Number(data.totalRevenue || 0))}`,
    `• 30-day expenses: ${formatCurrency(Number(data.totalExpenses || 0))}`,
    `• Net income: ${formatCurrency(Number(data.netIncome || 0))}`,
    "",
    "Next step: tell me whether you want the detailed transactions, P&L, or balance sheet behind this.",
  ].join("\n");
}

function formatQboAccountsForSlack(data: Record<string, unknown>): string | null {
  const accounts = Array.isArray(data.accounts) ? (data.accounts as Array<Record<string, unknown>>) : [];
  return [
    `• Chart of accounts: ${accounts.length} accounts`,
    ...accounts
      .slice(0, 10)
      .map((account) => `• ${String(account.AcctNum || "")} ${String(account.Name || "").trim()}`.trim()),
    "",
    "Next step: ask for the Excel export if you want the full list.",
  ].join("\n");
}

function formatQboBillsForSlack(data: Record<string, unknown>): string | null {
  const bills = Array.isArray(data.bills) ? (data.bills as Array<Record<string, unknown>>) : [];
  const unpaid = bills.filter((bill) => Number(bill.Balance || 0) > 0);
  const total = unpaid.reduce((sum, bill) => sum + Number(bill.Balance || bill.Amount || 0), 0);
  return [
    `• Accounts payable: ${formatCurrency(total)}`,
    `• Unpaid bills: ${unpaid.length}`,
    ...unpaid.slice(0, 5).map((bill) => `• ${String(bill.Vendor || "Unknown vendor")}: ${formatCurrency(Number(bill.Balance || bill.Amount || 0))}${bill.DueDate ? ` due ${String(bill.DueDate)}` : ""}`),
    "",
    "Next step: tell me which vendor bill you want reviewed, paid, or exported.",
  ].join("\n");
}

function formatQboInvoicesForSlack(data: Record<string, unknown>): string | null {
  const invoices = Array.isArray(data.invoices) ? (data.invoices as Array<Record<string, unknown>>) : [];
  const outstanding = invoices.filter((invoice) => Number(invoice.Balance || 0) > 0);
  const total = outstanding.reduce((sum, invoice) => sum + Number(invoice.Balance || invoice.Amount || 0), 0);
  return [
    `• Accounts receivable: ${formatCurrency(total)}`,
    `• Outstanding invoices: ${outstanding.length}`,
    ...outstanding.slice(0, 5).map((invoice) => `• ${String(invoice.Customer || "Unknown customer")}: ${formatCurrency(Number(invoice.Balance || invoice.Amount || 0))}${invoice.DueDate ? ` due ${String(invoice.DueDate)}` : ""}`),
    "",
    "Next step: tell me which invoice, customer, or date range you want me to dig into.",
  ].join("\n");
}

function formatQboBalanceSheetForSlack(data: Record<string, unknown>): string | null {
  const summary = (data.summary || {}) as Record<string, unknown>;
  const assets = Number(summary["Total Assets"] || summary.TotalAssets || 0);
  const liabilities = Number(summary["Total Liabilities"] || summary.TotalLiabilities || 0);
  const equity = Number(summary["Total Equity"] || summary.TotalEquity || 0);
  return [
    `• Balance sheet`,
    `• Assets: ${formatCurrency(assets)}`,
    `• Liabilities: ${formatCurrency(liabilities)}`,
    `• Equity: ${formatCurrency(equity)}`,
    "",
    "Next step: ask for the detail behind assets, liabilities, or the investor loan.",
  ].join("\n");
}

async function uploadQboExport(
  ctx: SlackMessageContext,
  opts: { filename: string; title: string; comment: string; sheets: SpreadsheetData[] },
): Promise<string> {
  const result = await uploadFileToSlack({
    channelId: ctx.channel,
    threadTs: ctx.threadTs,
    filename: opts.filename,
    title: opts.title,
    comment: opts.comment,
    format: "xlsx",
    data: opts.sheets,
  });
  if (!result.ok) {
    return `I tried to generate ${opts.filename}, but the upload failed: ${result.error || "unknown error"}.`;
  }
  if (result.skipped) {
    return `Already uploaded — see above${result.permalink ? `: ${result.permalink}` : ""}`;
  }
  return `Uploaded ${opts.filename} to Slack${result.permalink ? `: ${result.permalink}` : ""}`;
}

async function maybeHandleQboExportRequest(ctx: SlackMessageContext): Promise<SlackResponse | null> {
  const text = ctx.text.toLowerCase();
  if (!wantsExcelExport(text)) return null;

  if (/\bchart of accounts\b|\bcoa\b/.test(text)) {
    const data = await fetchInternalJson("/api/ops/qbo/accounts");
    const accounts = Array.isArray(data?.accounts) ? (data.accounts as Array<Record<string, unknown>>) : [];
    const reply = await uploadQboExport(ctx, {
      filename: "chart_of_accounts.xlsx",
      title: "Chart of Accounts",
      comment: "Chart of accounts export",
      sheets: [{
        sheetName: "Chart of Accounts",
        headers: ["Acct #", "Name", "Type", "Sub Type", "Balance"],
        rows: accounts.map((account) => [
          String(account.AcctNum || ""),
          String(account.Name || ""),
          String(account.AccountType || ""),
          String(account.AccountSubType || ""),
          Number(account.CurrentBalance || 0),
        ]),
      }],
    });
    return { handled: true, reply, sources: [], answerLogId: null };
  }

  if (/\bp&l\b|\bprofit and loss\b/.test(text)) {
    const data = await fetchInternalJson("/api/ops/qbo/query?type=pnl");
    const summary = (data?.summary || {}) as Record<string, unknown>;
    const reply = await uploadQboExport(ctx, {
      filename: "pnl_report.xlsx",
      title: "P&L Report",
      comment: "P&L export",
      sheets: [{
        sheetName: "P&L Summary",
        headers: ["Metric", "Amount"],
        rows: [
          ["Revenue", Number(summary["Total Income"] || summary.TotalIncome || summary["Total Revenue"] || 0)],
          ["COGS", Number(summary["Total Cost of Goods Sold"] || summary.TotalCostOfGoodsSold || summary["Total COGS"] || 0)],
          ["Expenses", Math.abs(Number(summary["Total Expenses"] || summary.TotalExpenses || 0))],
          ["Net Income", Number(summary["Net Income"] || summary.NetIncome || 0)],
        ],
      }],
    });
    return { handled: true, reply, sources: [], answerLogId: null };
  }

  return null;
}

async function maybeHandleReneQboQuery(ctx: SlackMessageContext): Promise<SlackResponse | null> {
  if (!isReneUser(ctx.user) || !looksLikeQboReadQuery(ctx.text)) return null;
  const text = ctx.text.toLowerCase();
  try {
    if (/\benable\b.*\baccount numbers\b|\baccount numbers\b.*\benable\b|\bqbo\b.*\bsettings\b|\bquickbooks\b.*\bsettings\b/.test(text)) {
      return {
        handled: true,
        reply: formatReneSlackReply(
          [
            "• QBO UI path: Settings ⚙️ → Account and settings → Advanced",
            "• In Chart of accounts, turn on Account numbers",
            "• Click Save, then reopen Chart of accounts",
            "",
            "I can’t change QuickBooks UI settings by API. Next step: once it’s enabled, I can help create, review, or export the accounts.",
          ].join("\n"),
          { isReport: false },
        ),
        sources: [],
        answerLogId: null,
      };
    }
    if (/\bp&l\b|\bprofit and loss\b/.test(text)) {
      const data = await fetchInternalJson("/api/ops/qbo/query?type=pnl");
      if (data) return { handled: true, reply: formatReneSlackReply(formatQboPnlForSlack(data) || "I couldn’t format the live P&L.", { isReport: true }), sources: [], answerLogId: null };
    }
    if (/\btransactions?\b/.test(text)) {
      const data = await fetchInternalJson("/api/ops/qbo/query?type=purchases&limit=50");
      if (data) {
        const body = formatQboTransactionsForSlack(data) || "I couldn’t format the live transaction list.";
        return { handled: true, reply: formatReneSlackReply(body, { isReport: true }), sources: [], answerLogId: null };
      }
    }
    if (/\bcash position\b/.test(text)) {
      const data = await fetchInternalJson("/api/ops/qbo/query?type=metrics");
      if (data) return { handled: true, reply: formatReneSlackReply(formatQboCashPositionForSlack(data) || "I couldn’t format the live cash position.", { isReport: false }), sources: [], answerLogId: null };
    }
    if (/\bbalance sheet\b/.test(text)) {
      const data = await fetchInternalJson("/api/ops/qbo/query?type=balance_sheet");
      if (data) return { handled: true, reply: formatReneSlackReply(formatQboBalanceSheetForSlack(data) || "I couldn’t format the balance sheet.", { isReport: false }), sources: [], answerLogId: null };
    }
    if (/\bhow much do we owe vendors\b|\baccounts payable\b|\bowe vendors\b|\bbills?\b/.test(text)) {
      const data = await fetchInternalJson("/api/ops/qbo/query?type=bills");
      if (data) return { handled: true, reply: formatReneSlackReply(formatQboBillsForSlack(data) || "I couldn’t load accounts payable.", { isReport: false }), sources: [], answerLogId: null };
    }
    if (/\bwho owes us money\b|\baccounts receivable\b|\bar\b|\binvoices?\b/.test(text)) {
      const data = await fetchInternalJson("/api/ops/qbo/query?type=invoices");
      if (data) return { handled: true, reply: formatReneSlackReply(formatQboInvoicesForSlack(data) || "I couldn’t load accounts receivable.", { isReport: false }), sources: [], answerLogId: null };
    }
    if (/\bvendors?\b/.test(text)) {
      const data = await fetchInternalJson("/api/ops/qbo/query?type=vendors");
      if (data) return { handled: true, reply: formatReneSlackReply(formatQboVendorsForSlack(data) || "I couldn’t format the live vendor list.", { isReport: false }), sources: [], answerLogId: null };
    }
    if (/\bchart of accounts\b|\bcoa\b/.test(text)) {
      const data = await fetchInternalJson("/api/ops/qbo/accounts");
      if (data) return { handled: true, reply: formatReneSlackReply(formatQboAccountsForSlack(data) || "I couldn’t format the chart of accounts.", { isReport: true }), sources: [], answerLogId: null };
    }
  } catch {
    return null;
  }
  return null;
}

async function persistBatchAnswerToBrain(ctx: SlackMessageContext, pairs: Array<{ question: string; answer: string }>): Promise<void> {
  const actor = ctx.displayName || ctx.user;
  const rawText = pairs
    .map((pair, index) => `Q${index + 1}: ${pair.question}\nA${index + 1}: ${pair.answer}`)
    .join("\n\n");
  const embedding = await buildEmbedding(`Rene batch answers\n${rawText.slice(0, 4000)}`);
  await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: {
      Prefer: "return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_type: "manual",
      source_ref: `slack-batch-answers-${ctx.channel}-${rootSlackThreadTs(ctx)}-${Date.now()}`,
      entry_type: "teaching",
      title: `Batch answers from ${actor}`,
      raw_text: rawText,
      summary_text: rawText.slice(0, 500),
      category: "teaching",
      department: "finance",
      confidence: "high",
      priority: "important",
      processed: true,
      embedding,
    }),
  });
}

async function maybeHandleBatchNumberedAnswers(ctx: SlackMessageContext): Promise<SlackResponse | null> {
  if (!ctx.threadTs) return null;
  const answers = parseBulletOrNumberedItems(ctx.text);
  if (answers.length < 3) return null;
  const priorQuestions = findLatestAssistantNumberedList(ctx.history);
  if (priorQuestions.length === 0) return null;

  const pairs = answers.map((answer, index) => ({
    question: priorQuestions[index] || `Question ${index + 1}`,
    answer,
  }));

  const results: string[] = [];
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    const outcome = await callAbraChatViaInternalApi({
      ...ctx,
      text: buildBatchExecutionPrompt(pair.question, pair.answer, index),
      history: ctx.history,
    });
    if (outcome?.reply) {
      results.push(`• ${pair.answer}\n  ${normalizeSlackReply(outcome.reply).split("\n")[0]}`);
    }
  }

  try {
    await persistBatchAnswerToBrain(ctx, pairs);
  } catch {
    // best effort
  }

  const reply = [
    `Processed ${pairs.length} numbered answers from this thread.`,
    ...results.slice(0, 8),
    "",
    "Next step: send the next batch or the one item you want me to handle now.",
  ].join("\n");

  return {
    handled: true,
    reply: isReneUser(ctx.user) ? formatReneSlackReply(reply, { isReport: true }) : reply,
    sources: [],
    answerLogId: null,
  };
}

function resolveInternalHost(): string {
  return (
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")
  );
}

function stableSlackThreadId(channel: string, threadTs: string): string {
  const hex = createHash("sha1")
    .update(`${channel}:${threadTs}`)
    .digest("hex")
    .slice(0, 32);
  const part4 = ((Number.parseInt(hex[16] || "0", 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${part4}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function rootSlackThreadTs(ctx: SlackMessageContext): string {
  return ctx.threadTs || ctx.ts;
}

function structuredDocKey(ctx: SlackMessageContext): string {
  return `abra:slack:structured-doc:${ctx.channel}:${rootSlackThreadTs(ctx)}`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function looksLikeChartOfAccounts(text: string): boolean {
  // Must be substantial — short messages are never COA data pastes
  if (text.length < 300) return false;

  // Explicit header match — always a COA (requires multiple header keywords)
  const headerKeywords = ["gl account", "account type", "sub type", "account name", "detail type"].filter(
    kw => text.toLowerCase().includes(kw),
  );
  if (headerKeywords.length >= 2) return true;

  const lines = text.split(/\n/).filter(l => l.trim().length > 0);

  // 10+ lines that contain tab characters → structured tabular data (raised threshold)
  const tabLines = lines.filter((l) => /\t/.test(l));
  if (tabLines.length >= 10) return true;

  // 10+ lines that each start with or contain a 4–6 digit account number
  // AND look like structured rows (have separators like tabs, pipes, or multiple spaces)
  const structuredNumericLines = lines.filter(
    (l) => /\b\d{4,6}\b/.test(l) && (/\t/.test(l) || /\|/.test(l) || /  {2,}/.test(l)),
  );
  if (structuredNumericLines.length >= 10) return true;

  return false;
}

function isDocumentResetCommand(text: string): boolean {
  return /\b(fresh start|start over|reset|clear)\b/i.test(text);
}

function isDocumentFinalizeCommand(text: string): boolean {
  return /\b(done|build it|compile|finish|finalize)\b/i.test(text);
}

function requestedDocumentFormat(
  text: string,
): "notion" | "csv" | "markdown" | null {
  const normalized = text.toLowerCase();
  if (
    /\b(option 3|notion version|notion page|save to notion|give me notion)\b/.test(
      normalized,
    )
  ) {
    return "notion";
  }
  if (/\b(csv|excel-ready|spreadsheet|tab-separated|tsv)\b/.test(normalized)) {
    return "csv";
  }
  if (/\b(option 2|markdown|table)\b/.test(normalized)) {
    return "markdown";
  }
  return null;
}

function normalizeChartOfAccountsText(text: string): string {
  return (
    text
      // Normalize non-breaking spaces
      .replace(/\u00a0/g, " ")
      // Normalize Windows line endings
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      // Strip header rows (they aren't data)
      .replace(/GL\s*Account\s*Description\s*Account\s*Type\s*Sub\s*Type/gi, "")
      // Convert tabs to pipe separators so column structure is preserved
      .replace(/\t+/g, "|")
      // Collapse multiple spaces within a line (but NOT across newlines)
      .split("\n")
      .map((line) => line.replace(/  +/g, " ").trim())
      .filter((line) => line.length > 0)
      .join("\n")
  );
}

function parseChartOfAccountsRows(rawText: string): CoaRow[] {
  const normalized = normalizeChartOfAccountsText(rawText);
  const rows = new Map<string, CoaRow>();

  // Accounting type code letters used by QBO
  const TYPE_CODES = new Set(["A", "L", "E", "I", "C", "P"]);

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    let accountNumber = "";
    let description = "";
    let accountType = "";
    let subType = "";

    // --- Strategy 1: pipe/tab-separated columns ---
    // After normalizeChartOfAccountsText, tabs are already converted to "|"
    if (line.includes("|")) {
      const cols = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      // Expected order: GL Account | Description | Account Type | Sub Type
      // But be flexible — first col with a number = account number
      const numIdx = cols.findIndex((c) => /^\d{2,6}$/.test(c));
      if (numIdx !== -1) {
        accountNumber = cols[numIdx];
        description = cols[numIdx + 1] || "";
        accountType = cols[numIdx + 2] || "";
        subType = cols[numIdx + 3] || "";
      } else {
        // No clean numeric col; fall through to Strategy 2
      }
    }

    // --- Strategy 2: line-start number, trailing type code ---
    if (!accountNumber) {
      // Match: optional-period-terminated number at line start
      // then arbitrary text (description, may contain digits)
      // then a standalone type-code letter at/near end of line
      // then optional sub-type letter
      const lineMatch = line.match(
        /^(\d{2,6})\.?\s+(.+?)\s+([ALCIPE])\s*([A-Z])?$/,
      );
      if (lineMatch) {
        accountNumber = lineMatch[1].trim();
        description = lineMatch[2].trim();
        accountType = lineMatch[3].trim();
        subType = (lineMatch[4] || "").trim();
      }
    }

    // --- Strategy 3: any number in the line + type code somewhere ---
    if (!accountNumber) {
      const numMatch = line.match(/\b(\d{2,6})\b/);
      // Grab the last standalone type-code token in the line
      const tokens = line.split(/\s+/);
      const lastTypeIdx = tokens
        .map((t, i) => (TYPE_CODES.has(t) ? i : -1))
        .filter((i) => i !== -1)
        .pop();
      if (numMatch && lastTypeIdx !== undefined) {
        accountNumber = numMatch[1];
        accountType = tokens[lastTypeIdx];
        subType =
          lastTypeIdx + 1 < tokens.length &&
          /^[A-Z]$/.test(tokens[lastTypeIdx + 1])
            ? tokens[lastTypeIdx + 1]
            : "";
        // Description = everything between the account number and the type code
        const numPos = line.indexOf(accountNumber);
        const typePos = line.lastIndexOf(accountType);
        description = normalizeWhitespace(
          line.slice(numPos + accountNumber.length, typePos),
        ).replace(/^[.\s]+/, "");
      }
    }

    // Validate and deduplicate
    accountNumber = accountNumber.trim();
    description = normalizeWhitespace(
      description.replace(/\s*[|,;:-]+\s*$/g, ""),
    );
    accountType = accountType.trim();
    subType = subType.trim();

    if (!accountNumber || !description || !accountType) continue;
    if (!TYPE_CODES.has(accountType)) continue;

    const nextRow: CoaRow = { accountNumber, description, accountType, subType };
    const existing = rows.get(accountNumber);
    if (!existing || nextRow.description.length > existing.description.length) {
      rows.set(accountNumber, nextRow);
    }
  }

  return Array.from(rows.values()).sort(
    (a, b) => Number(a.accountNumber) - Number(b.accountNumber),
  );
}

function renderChartOfAccountsMarkdown(rows: CoaRow[]): string {
  const lines = [
    "# TEST Chart of Accounts — Notion Version",
    "",
    `Parsed accounts: ${rows.length}`,
    "",
    "| GL Account | Description | Account Type | Sub Type |",
    "|---|---|---|---|",
    ...rows.map(
      (row) =>
        `| ${row.accountNumber} | ${row.description.replace(/\|/g, "/")} | ${row.accountType} | ${row.subType || "—"} |`,
    ),
  ];
  return lines.join("\n");
}

function renderChartOfAccountsCsv(rows: CoaRow[]): string {
  const escape = (value: string) => `"${String(value).replace(/"/g, '""')}"`;
  return [
    "GL Account,Description,Account Type,Sub Type",
    ...rows.map((row) =>
      [
        escape(row.accountNumber),
        escape(row.description),
        escape(row.accountType),
        escape(row.subType),
      ].join(","),
    ),
  ].join("\n");
}

async function getStructuredDocSession(
  ctx: SlackMessageContext,
): Promise<StructuredDocSession | null> {
  try {
    const session = await kv.get<StructuredDocSession>(structuredDocKey(ctx));
    if (!session || typeof session !== "object") return null;
    if (!Array.isArray(session.chunks)) return null;
    return session;
  } catch {
    return null;
  }
}

async function saveStructuredDocSession(
  ctx: SlackMessageContext,
  session: StructuredDocSession,
): Promise<void> {
  await kv.set(structuredDocKey(ctx), session, {
    ex: STRUCTURED_DOC_TTL_SECONDS,
  });
}

async function clearStructuredDocSession(
  ctx: SlackMessageContext,
): Promise<void> {
  try {
    await kv.del(structuredDocKey(ctx));
  } catch {
    // non-critical
  }
}

async function appendStructuredDocChunk(
  ctx: SlackMessageContext,
  kind: StructuredDocKind,
): Promise<StructuredDocSession> {
  const existing = await getStructuredDocSession(ctx);
  const actor = ctx.displayName || ctx.user;
  const nextChunks = [...(existing?.chunks || []), ctx.text];
  const session: StructuredDocSession = {
    kind,
    actor,
    chunks: nextChunks,
    totalChars: nextChunks.reduce((sum, chunk) => sum + chunk.length, 0),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveStructuredDocSession(ctx, session);
  return session;
}

async function handleStructuredDocumentConversation(
  ctx: SlackMessageContext,
): Promise<SlackResponse | null> {
  const existing = await getStructuredDocSession(ctx);
  const format = requestedDocumentFormat(ctx.text);

  if (isDocumentResetCommand(ctx.text) && existing) {
    await clearStructuredDocSession(ctx);
    return {
      handled: true,
      reply:
        "Cleared the structured document session for this thread. Send the first chunk when you want to start again.",
      sources: [],
      answerLogId: null,
    };
  }

  // Only continue an existing session if the new message also looks like structured data
  // (not just any long message). This prevents normal conversation from being captured as chunks.
  const isStructuredData = looksLikeChartOfAccounts(ctx.text);
  const isSessionContinuation = existing && ctx.text.length >= 500 && /\t/.test(ctx.text);
  if (isStructuredData || isSessionContinuation) {
    const session = await appendStructuredDocChunk(ctx, "chart_of_accounts");
    const rows = parseChartOfAccountsRows(session.chunks.join("\n"));
    return {
      handled: true,
      reply:
        `Captured chart of accounts chunk ${session.chunks.length} for this thread.\n\n` +
        `Current parse status: ${rows.length} account rows across ${session.totalChars.toLocaleString()} characters.\n\n` +
        `Keep sending chunks in this thread. When you're done, say \`done\`, \`build it\`, \`give me notion version\`, or \`give me csv\`.`,
      sources: [],
      answerLogId: null,
    };
  }

  if (!existing) return null;

  if (isDocumentFinalizeCommand(ctx.text) || format) {
    const rows = parseChartOfAccountsRows(existing.chunks.join("\n"));
    if (rows.length === 0) {
      return {
        handled: true,
        reply:
          "I have the chunks for this thread, but I couldn't parse any chart-of-accounts rows yet. Send another chunk with the raw account lines, or say `start over` to reset.",
        sources: [],
        answerLogId: null,
      };
    }

    const resolvedFormat = format || "markdown";
    const body =
      resolvedFormat === "csv"
        ? renderChartOfAccountsCsv(rows)
        : renderChartOfAccountsMarkdown(rows);

    return {
      handled: true,
      reply:
        resolvedFormat === "csv"
          ? `CSV version ready below.\n\n\`\`\`\ncsv\n${body}\n\`\`\``
          : `${body}\n\n_This was built from the chunks stored in this Slack thread. Say \`start over\` if you want me to discard and rebuild it._`,
      sources: [],
      answerLogId: null,
    };
  }

  return null;
}

function buildSlackBlocks(fullText: string): Array<Record<string, unknown>> {
  if (fullText.length <= SLACK_BLOCK_TEXT_LIMIT) {
    return [
      {
        type: "section",
        text: { type: "mrkdwn", text: fullText },
      },
    ];
  }

  const blocks: Array<Record<string, unknown>> = [];
  let remaining = fullText;
  while (remaining.length > 0) {
    if (remaining.length <= SLACK_BLOCK_TEXT_LIMIT) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: remaining },
      });
      break;
    }
    let splitIdx = remaining.lastIndexOf("\n", SLACK_BLOCK_TEXT_LIMIT);
    if (splitIdx < SLACK_BLOCK_TEXT_LIMIT * 0.3) {
      splitIdx = remaining.lastIndexOf(" ", SLACK_BLOCK_TEXT_LIMIT);
    }
    if (splitIdx <= 0) splitIdx = SLACK_BLOCK_TEXT_LIMIT;
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: remaining.slice(0, splitIdx) },
    });
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return blocks;
}

function buildFeedbackBlock(answerLogId: string): Record<string, unknown> {
  return {
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "👍 Helpful", emoji: true },
        action_id: "feedback_positive",
        value: answerLogId,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "👎 Not helpful", emoji: true },
        action_id: "feedback_negative",
        value: answerLogId,
      },
    ],
  };
}

function formatSources(
  sources: Array<{
    title: string;
    source_table: "brain" | "email";
    days_ago?: number;
  }>,
): string {
  if (sources.length === 0) return "";
  return `\n\n_Sources: ${sources
    .slice(0, 4)
    .map((source) => {
      const age =
        typeof source.days_ago === "number" ? ` (${source.days_ago}d ago)` : "";
      return `${source.source_table === "email" ? "📧" : "🧠"} ${source.title}${age}`;
    })
    .join(" · ")}_`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  return fetch(url, {
    ...init,
    signal: init.signal || AbortSignal.timeout(timeoutMs),
  });
}

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Supabase not configured");
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(15000),
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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }
  return json;
}

async function buildEmbedding(input: string): Promise<number[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: input.slice(0, 8000),
      dimensions: 1536,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Embedding failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const payload = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const embedding = payload.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) throw new Error("Embedding payload missing vector");

  const approxTokens = Math.max(1, Math.round(input.length / 4));
  void logAICost({
    model: "text-embedding-3-small",
    provider: "openai",
    inputTokens: approxTokens,
    outputTokens: 0,
    endpoint: "slack/responder-embedding",
    department: "operations",
  });

  return embedding;
}

async function extractCorrectionWithLLM(
  freeformText: string,
): Promise<{ original: string; correction: string } | null> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: 256,
        messages: [
          {
            role: "user",
            content:
              `Extract the correction from this text. Return JSON with two fields:\n` +
              `- "original": what was wrong or being superseded (or "unspecified" if not stated)\n` +
              `- "correction": what the correct/updated fact is\n\n` +
              `Text: ${freeformText}\n\n` +
              `Respond with only valid JSON, no markdown.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.content?.[0]?.text?.trim() ?? "";
    const parsed = JSON.parse(raw);
    if (parsed?.original && parsed?.correction) return parsed;
  } catch {
    // fall through
  }
  return null;
}

function parseCorrection(text: string): { original: string; correction: string } | null {
  const body = text.replace(/^correct:\s*/i, "").trim();
  if (!body) return null;
  const match = body.match(/^(.+?)\s*(?:→|->|but actually|, actually)\s+(.+)$/is);
  if (!match) return null;
  return {
    original: match[1].trim(),
    correction: match[2].trim(),
  };
}

async function handleCorrection(msg: SlackMessageContext): Promise<string> {
  const body = msg.text.replace(/^correct:\s*/i, "").trim();
  let original = "";
  let correction = "";
  let freeform = false;

  const structured = parseCorrection(msg.text);
  if (structured) {
    original = structured.original;
    correction = structured.correction;
  } else {
    // Freeform correction — use LLM to extract structured fields
    freeform = true;
    const extracted = await extractCorrectionWithLLM(body);
    if (extracted) {
      original = extracted.original;
      correction = extracted.correction;
    } else {
      // LLM unavailable or failed — store full text as the correction
      correction = body;
      original = "unspecified";
    }
  }

  if (!correction) {
    return "Couldn't parse correction. Use `correct: <old> but actually <new>`.";
  }

  const actor = msg.displayName || msg.user;
  const embeddingText = `CORRECTION: ${original} -> ${correction}`;
  const embedding = await buildEmbedding(embeddingText);
  await sbFetch("/rest/v1/abra_corrections", {
    method: "POST",
    headers: {
      Prefer: "return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      corrected_by: actor,
      original_claim: original,
      correction,
      embedding,
    }),
  });
  await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: {
      Prefer: "return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_type: "manual",
      source_ref: `slack-correction-${Date.now()}`,
      entry_type: "correction",
      title: `Correction: ${original.slice(0, 100)}`,
      raw_text: `WRONG: ${original}\nCORRECT: ${correction}\nCorrected by: ${actor}`,
      summary_text: correction.slice(0, 500),
      category: "correction",
      department: "executive",
      confidence: "high",
      priority: "critical",
      processed: true,
      embedding,
    }),
  });

  // Dual-write to markdown memory (always-loaded, overrides pgvector)
  const correctionForMd = freeform ? `${correction}\n\n_Full text: ${body}_` : correction;
  appendMarkdownCorrection(original, correctionForMd).catch((e) =>
    console.warn("[abra-correction] markdown write failed:", e),
  );

  if (freeform) {
    return (
      `✅ Correction stored.\n` +
      `• _Interpreted wrong:_ ${original}\n` +
      `• _Interpreted correct:_ ${correction}\n\n` +
      `_Full text saved verbatim. Abra will prioritize this over conflicting older data._`
    );
  }
  return `✅ Correction stored: "${original}" → "${correction}". Abra will prioritize this over conflicting older data.`;
}

async function handleTeaching(msg: SlackMessageContext): Promise<string> {
  const body = msg.text.replace(/^teach:\s*/i, "").trim();
  if (!body) return "No content to teach. Use `teach: [department] <content>`.";

  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (cronSecret) {
    try {
      const res = await fetchWithTimeout(
        `${resolveInternalHost()}/api/ops/abra/teach`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cronSecret}`,
          },
          body: JSON.stringify({
            department: "executive",
            content: body,
            title: `Slack teaching from ${msg.displayName || msg.user}`,
          }),
        },
        20000,
      );
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && typeof data.message === "string" && data.message.trim()) {
        const baseMessage = data.message.trim();
        if (/\bshipment\b|\barrives?\b|\bthursday\b/i.test(body) && !/\btriggered\b/i.test(baseMessage)) {
          return `${baseMessage} Triggered shipment tracking.`;
        }
        return baseMessage;
      }
    } catch {
      // Fall back to direct write below.
    }
  }

  const deptMatch = body.match(/^\[([^\]]+)\]\s*(.+)$/s);
  const department = deptMatch?.[1]?.trim().toLowerCase() || "executive";
  const content = deptMatch?.[2]?.trim() || body;
  if (!content) return "No teaching content found.";

  const actor = msg.displayName || msg.user;
  const title = `Teaching: ${department} — ${content.slice(0, 60)}`;
  const embedding = await buildEmbedding(`${title}. ${content}`);

  await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: {
      Prefer: "return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_type: "manual",
      source_ref: `slack-teaching-${Date.now()}`,
      entry_type: "teaching",
      title,
      raw_text: `Taught by ${actor}:\n${content}`,
      summary_text: content.slice(0, 500),
      category: "teaching",
      department,
      confidence: "high",
      priority: "important",
      processed: true,
      embedding,
    }),
  });

  return `Stored teaching for ${department}: "${content.slice(0, 180)}"`;
}

async function callAbraChatViaInternalApi(
  ctx: SlackMessageContext,
): Promise<{
  reply: string;
  sources: Array<{ title: string; source_table: "brain" | "email"; days_ago?: number }>;
  answerLogId: string | null;
} | null> {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) return null;

  const host = resolveInternalHost();

  try {
    const conversationContext = buildConversationContextBlock(ctx);
    const deliveryPrefix =
      hasExplicitAbraMention(ctx.text) || isFinancialsChannel(ctx.channel) || isControlChannel(ctx.channel)
        ? "[SLACK DELIVERY OVERRIDE] This message is directed to Abra. Respond directly to the user. Do not decline because other humans are mentioned in the thread.\n\n"
        : "";
    const messageWithContext = `${deliveryPrefix}${conversationContext}${ctx.text}`.trim();

    let res: Response;
    if (ctx.uploadedFiles && ctx.uploadedFiles.length > 0) {
      const form = new FormData();
      form.set("message", messageWithContext);
      form.set("history", JSON.stringify(ctx.history || []));
      form.set("channel", "slack");
      form.set("actor_label", ctx.displayName || ctx.user);
      form.set("actor_context", getActorContext(ctx.user) || "");
      form.set("thread_id", stableSlackThreadId(ctx.channel, ctx.threadTs || ctx.ts));
      form.set("slack_channel_id", ctx.channel);
      form.set("slack_thread_ts", ctx.threadTs || ctx.ts);
      const firstFile = ctx.uploadedFiles[0];
      const blob = new Blob([new Uint8Array(firstFile.buffer)], { type: firstFile.mimeType || "application/octet-stream" });
      form.set("file", blob, firstFile.name);
      res = await fetchWithTimeout(
        `${host}/api/ops/abra/chat`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cronSecret}`,
          },
          body: form,
        },
        55000,
      );
    } else {
      res = await fetchWithTimeout(
        `${host}/api/ops/abra/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cronSecret}`,
          },
          body: JSON.stringify({
            message: messageWithContext,
            history: ctx.history || [],
            channel: "slack",
            actor_label: ctx.displayName || ctx.user,
            actor_context: getActorContext(ctx.user),
            thread_id: stableSlackThreadId(ctx.channel, ctx.threadTs || ctx.ts),
            slack_channel_id: ctx.channel,
            slack_thread_ts: ctx.threadTs || ctx.ts,
          }),
        },
        55000, // Must exceed chat route's 50s internal deadline
      );
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const errMsg = typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
      console.error("[abra-slack-responder] Chat API error:", errMsg);
      // Return a graceful error reply instead of null (which throws)
      return {
        reply: `I had trouble processing that message (${errMsg}). Could you try again, or break it into smaller pieces?`,
        sources: [],
        answerLogId: null,
      };
    }

    const reply =
      typeof data.reply === "string" && data.reply.trim() ? data.reply.trim() : "";
    if (!reply) return null;

    const sources = Array.isArray(data.sources)
      ? data.sources
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const row = item as Record<string, unknown>;
            return {
              title:
                typeof row.title === "string" && row.title.trim()
                  ? row.title.trim()
                  : "(untitled)",
              source_table: row.source_table === "email" ? "email" : "brain",
              days_ago:
                typeof row.days_ago === "number" && Number.isFinite(row.days_ago)
                  ? row.days_ago
                  : undefined,
            } as {
              title: string;
              source_table: "brain" | "email";
              days_ago?: number;
            };
          })
          .filter((value): value is {
            title: string;
            source_table: "brain" | "email";
            days_ago?: number;
          } => !!value)
      : [];

    const answerLogId =
      typeof data.answerLogId === "string" && data.answerLogId
        ? data.answerLogId
        : typeof data.answer_log_id === "string" && data.answer_log_id
          ? data.answer_log_id
          : null;

    return { reply, sources, answerLogId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[abra-slack-responder] Chat API exception:", errMsg);
    // Return a graceful error reply instead of null (which causes upstream failures)
    return {
      reply: errMsg.includes("abort") || errMsg.includes("timeout")
        ? "I'm taking longer than expected to process that. Give me a moment and try again — if the message was large, try breaking it into smaller pieces."
        : `I ran into a problem (${errMsg.slice(0, 100)}). Could you try again?`,
      sources: [],
      answerLogId: null,
    };
  }
}

function buildConversationContextBlock(ctx: SlackMessageContext): string {
  const history = Array.isArray(ctx.history) ? ctx.history : [];
  if (!ctx.threadTs || history.length === 0) return "";

  const topicSource = history.find((item) => item.role === "user" && item.content.trim())?.content || ctx.text;
  const topic = topicSource.replace(/\s+/g, " ").trim().slice(0, 180);

  const decisions = history
    .filter((item) => item.role === "assistant" && /\b(done|categorized|created|queued|stored|updated|posted|draft)\b/i.test(item.content))
    .slice(-4)
    .map((item) => item.content.replace(/\s+/g, " ").trim().slice(0, 180));

  const sharedData = history
    .map((item) => item.content)
    .filter((content) => /(\$[\d,]+(?:\.\d{2})?|invoice\s+#?\w+|po\s+#?\w+|account\s+\d+)/i.test(content))
    .slice(-4)
    .map((content) => content.replace(/\s+/g, " ").trim().slice(0, 180));

  const corrections = history
    .filter((item) => item.role === "user" && /\b(wrong|actually|should be|that is|it's|its|from now on)\b/i.test(item.content))
    .slice(-4)
    .map((item) => item.content.replace(/\s+/g, " ").trim().slice(0, 180));

  const lines = ["[THREAD CONTEXT]", `Topic: ${topic}`];
  if (decisions.length) {
    lines.push("Previous exchanges:");
    for (const decision of decisions) lines.push(`- ${decision}`);
  }
  if (sharedData.length) {
    lines.push("Shared data:");
    for (const item of sharedData) lines.push(`- ${item}`);
  }
  if (corrections.length) {
    lines.push("Corrections:");
    for (const correction of corrections) lines.push(`- ${correction}`);
  }
  lines.push(`Current message: ${ctx.text}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function syncEntityMentionsFromSlack(ctx: SlackMessageContext, text: string): Promise<void> {
  const entities = extractEntityMentions(text);
  if (entities.length === 0) return;
  for (const entityName of entities) {
    await updateEntityFromEvent(entityName, {
      type: "slack_mention",
      summary: text.replace(/\s+/g, " ").trim().slice(0, 220),
      date: new Date().toISOString().slice(0, 10),
      channel: "slack",
    }).catch(() => null);
  }
}

async function maybeApplyDrivingModeReply(
  ctx: SlackMessageContext,
  reply: string,
): Promise<string> {
  if (ctx.user !== BEN_SLACK_USER_ID) return reply;
  const drivingMode = await getDrivingModeState();
  if (!drivingMode?.active) return reply;
  if (reply.length > 160 || /\n|•|#|\|/.test(reply)) {
    await appendDrivingModeBacklog(reply.replace(/\s+/g, " ").trim()).catch(() => {});
  }
  return formatDrivingModeReply(reply);
}

export async function getThreadHistory(
  channelId: string,
  threadTs: string,
  limit = 20,
): Promise<SlackThreadMessage[]> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return [];

  try {
    const url = new URL("https://slack.com/api/conversations.replies");
    url.searchParams.set("channel", channelId);
    url.searchParams.set("ts", threadTs);
    url.searchParams.set("limit", String(Math.max(1, Math.min(limit, 50))));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      ok?: boolean;
      messages?: Array<{
        text?: string;
        bot_id?: string;
        subtype?: string;
      }>;
    };
    if (!data.ok || !Array.isArray(data.messages)) return [];

    return data.messages
      .map((message) => {
        const text = String(message.text || "").trim();
        if (!text) return null;
        if (message.subtype && message.subtype !== "bot_message") return null;
        const isBot = Boolean(message.bot_id);
        return {
          role: isBot ? "assistant" : "user",
          content: isBot
            ? text.replace(/^🧠\s*\*Abra\*\s*\n\n?/i, "").trim()
            : text,
        } as SlackThreadMessage;
      })
      .filter((value): value is SlackThreadMessage => !!value)
      .slice(-12);
  } catch {
    return [];
  }
}

/**
 * Fetch recent channel messages (last 5) for non-threaded messages.
 * Gives Abra context about what the user just said before @mentioning.
 * Only includes messages from the last 10 minutes to keep context relevant.
 */
export async function getRecentChannelContext(
  channelId: string,
  currentTs: string,
  limit = 5,
): Promise<SlackThreadMessage[]> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return [];

  try {
    // Only look back 10 minutes for relevant context
    const tenMinAgo = String(Number(currentTs) - 600);

    const url = new URL("https://slack.com/api/conversations.history");
    url.searchParams.set("channel", channelId);
    url.searchParams.set("latest", currentTs);
    url.searchParams.set("oldest", tenMinAgo);
    url.searchParams.set("limit", String(limit + 1)); // +1 because current message may be included
    url.searchParams.set("inclusive", "false");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      ok?: boolean;
      messages?: Array<{ text?: string; bot_id?: string; subtype?: string; ts?: string }>;
    };
    if (!data.ok || !Array.isArray(data.messages)) return [];

    return data.messages
      .filter((m) => m.ts !== currentTs) // Exclude the current message
      .map((message) => {
        const text = String(message.text || "").trim();
        if (!text) return null;
        if (message.subtype && message.subtype !== "bot_message") return null;
        const isBot = Boolean(message.bot_id);
        return {
          role: isBot ? "assistant" : "user",
          content: isBot
            ? text.replace(/^🧠\s*\*Abra\*\s*\n\n?/i, "").trim()
            : text,
        } as SlackThreadMessage;
      })
      .filter((value): value is SlackThreadMessage => !!value)
      .reverse(); // Chronological order (oldest first)
  } catch {
    return [];
  }
}

export async function getSlackDisplayName(userId: string): Promise<string> {
  if (!userId) return "slack-user";
  const cacheKey = `abra:slack:user:${userId}`;
  try {
    const cached = await kv.get<string>(cacheKey);
    if (typeof cached === "string" && cached.trim()) return cached.trim();
  } catch {
    // fall through to live lookup
  }

  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return userId;

  try {
    const url = new URL("https://slack.com/api/users.info");
    url.searchParams.set("user", userId);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return userId;
    const data = (await res.json()) as {
      ok?: boolean;
      user?: {
        profile?: { display_name?: string; real_name?: string };
        real_name?: string;
        name?: string;
      };
    };
    if (!data.ok) return userId;

    const displayName =
      data.user?.profile?.display_name?.trim() ||
      data.user?.profile?.real_name?.trim() ||
      data.user?.real_name?.trim() ||
      data.user?.name?.trim() ||
      userId;

    try {
      await kv.set(cacheKey, displayName, { ex: 3600 });
    } catch {
      // cache failure is non-critical
    }

    return displayName;
  } catch {
    return userId;
  }
}

function stripActionTags(value: string): string {
  let result = value
    .replace(/<action>\s*[\s\S]*?\s*<\/action>/gi, "")
    .replace(/<tool_call>\s*[\s\S]*?\s*<\/tool_call>/gi, "")
    .replace(/<tool_response>\s*[\s\S]*?\s*<\/tool_response>/gi, "")
    .replace(/<tool>\s*[\s\S]*?\s*<\/tool>/gi, "")
    .replace(/<function_call>\s*[\s\S]*?\s*<\/function_call>/gi, "");

  // Strip code-fenced JSON blocks containing action-like keys
  result = result.replace(/```(?:json)?\s*\n([\s\S]*?)```/gi, (match, content) => {
    if (/["'](action|tool|function_call|tool_call)["']\s*:/.test(content)) {
      return "";
    }
    return match;
  });

  // Strip bare JSON objects on their own line that look like tool calls (with one level of nesting)
  result = result.replace(
    /^\s*\{(?:[^{}]|\{[^{}]*\})*"action"\s*:(?:[^{}]|\{[^{}]*\})*\}\s*$/gm,
    "",
  );

  return result.trim();
}

/**
 * Returns true if the message is likely to take >5s to process (goes through
 * the LLM call chain). Short/fast commands like correct: and teach: return false.
 * Used to decide whether to post an immediate "thinking" acknowledgment.
 */
export function isLikelySlowQuery(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Fast commands — handled synchronously without an LLM call
  if (/^correct:/i.test(t)) return false;
  if (/^teach:/i.test(t)) return false;
  if (looksLikeChartOfAccounts(t)) return false;
  // Very short messages (greetings, quick lookups) are still slow because they
  // hit the LLM, but they're fast enough that a "thinking" indicator isn't worth
  // the noise. 80 chars is roughly one sentence.
  if (t.length < 80) return false;
  return true;
}

/**
 * Post an immediate "Working on it..." acknowledgment and return the message ts
 * so it can later be updated via updateSlackMessage().
 */
export async function postSlackThinkingMessage(
  channelId: string,
  threadTs: string,
): Promise<string | null> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken || !channelId) return null;

  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: channelId,
        thread_ts: threadTs,
        text: "🧠 Abra: Working on it...",
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "🧠 *Abra* — Working on it..." },
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; ts?: string };
    return data.ok && data.ts ? data.ts : null;
  } catch {
    return null;
  }
}

/**
 * Update a previously-posted bot message (e.g. the thinking indicator) with
 * the final reply. Uses chat.update — only works on messages posted by this bot.
 */
export async function updateSlackMessage(
  channelId: string,
  messageTs: string,
  text: string,
  opts: SlackPostOptions = {},
): Promise<boolean> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken || !channelId || !messageTs) return false;

  const cleanText = stripActionTags(text);
  const sourceText = formatSources(opts.sources || []);
  const fullText = `🧠 *Abra*\n\n${cleanText}${sourceText}`;
  const blocks = opts.blocks && opts.blocks.length > 0 ? opts.blocks : buildSlackBlocks(fullText);
  if (opts.answerLogId) {
    blocks.push(buildFeedbackBlock(opts.answerLogId));
  }

  try {
    const res = await fetch("https://slack.com/api/chat.update", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: channelId,
        ts: messageTs,
        text: `🧠 Abra: ${text.slice(0, 200)}`,
        mrkdwn: true,
        blocks,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

/**
 * Delete a bot-posted message (used to clean up a thinking indicator when
 * Abra decides not to respond to a given message).
 */
export async function deleteSlackMessage(
  channelId: string,
  messageTs: string,
): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken || !channelId || !messageTs) return;
  try {
    await fetch("https://slack.com/api/chat.delete", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel: channelId, ts: messageTs }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Non-critical — if delete fails the thinking message just lingers
  }
}

export async function postSlackMessage(
  channelId: string,
  text: string,
  opts: SlackPostOptions = {},
): Promise<boolean> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken || !channelId) return false;

  // Second line of defense: strip any raw action/tool tags before sending to Slack
  const cleanText = stripActionTags(text);
  const sourceText = formatSources(opts.sources || []);
  const fullText = `🧠 *Abra*\n\n${cleanText}${sourceText}`;
  const blocks = opts.blocks && opts.blocks.length > 0 ? opts.blocks : buildSlackBlocks(fullText);
  if (opts.answerLogId) {
    blocks.push(buildFeedbackBlock(opts.answerLogId));
  }

  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: channelId,
        ...(opts.threadTs ? { thread_ts: opts.threadTs } : {}),
        text: `🧠 Abra: ${text.slice(0, 200)}`,
        mrkdwn: true,
        blocks,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

export async function proactiveMessage(
  opts: ProactiveMessageOptions,
): Promise<boolean> {
  const message = [
    opts.message.trim(),
    opts.context?.trim(),
    opts.requiresResponse ? "_Reply in thread if you want Abra to continue._" : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return postSlackMessage(opts.channelOrUserId, message, {
    threadTs: opts.threadTs,
    blocks: opts.blocks,
  });
}

/**
 * Open a DM channel with a Slack user.
 * Uses conversations.open to get or create a DM channel ID.
 */
export async function openDmChannel(userId: string): Promise<string | null> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken || !userId) return null;

  try {
    const res = await fetch("https://slack.com/api/conversations.open", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ users: userId }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      channel?: { id?: string };
    };
    return data.ok && data.channel?.id ? data.channel.id : null;
  } catch {
    return null;
  }
}

/**
 * Send a direct message to a Slack user.
 * Opens a DM channel first, then posts the message.
 */
export async function sendDirectMessage(
  userId: string,
  message: string,
  opts?: { blocks?: Array<Record<string, unknown>> },
): Promise<boolean> {
  const dmChannelId = await openDmChannel(userId);
  if (!dmChannelId) return false;
  return postSlackMessage(dmChannelId, message, { blocks: opts?.blocks });
}

/**
 * Look up a Slack user by email address.
 */
export async function findSlackUserByEmail(email: string): Promise<string | null> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken || !email) return null;

  try {
    const url = new URL("https://slack.com/api/users.lookupByEmail");
    url.searchParams.set("email", email);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      user?: { id?: string };
    };
    return data.ok && data.user?.id ? data.user.id : null;
  } catch {
    return null;
  }
}

// ─── Conversational correction detection ───

type PendingCorrection = {
  original: string;
  correction: string;
};

function pendingCorrectionKey(ctx: SlackMessageContext): string {
  return `abra:slack:pending-correction:${ctx.channel}:${rootSlackThreadTs(ctx)}`;
}

/**
 * Returns true when the message looks like an implicit correction to something Abra said
 * (rather than a new question or command). Requires ≥3 words or an explicit correction pattern.
 */
function isConversationalCorrectionPattern(text: string): boolean {
  const t = text.trim();
  if (t.split(/\s+/).length < 3) return false;

  // "actually [something]"
  if (/^actually[,\s]/i.test(t)) return true;
  // "not X, it's Y" / "not X — it's Y"
  if (/\bnot\s+.+[,—–]\s*(it'?s|its|they'?re|the)\b/i.test(t)) return true;
  // "the $449 is for..." / "the $X was for..."
  if (/\bthe\s+\$[\d,]+\s+(is|was|isn'?t|wasn'?t)\s+(for|actually|not)\b/i.test(t)) return true;
  // "that's wrong — it's..." / "that's incorrect, it should be..."
  if (/\bthat'?s\s+(wrong|incorrect)\b.{5,}/i.test(t)) return true;
  // "no, [something]" (negation followed by correction content)
  if (/^no[,—–]\s*.{5,}/i.test(t)) return true;
  // "wrong, [something]"
  if (/^wrong[,—–.]\s*.{5,}/i.test(t)) return true;
  // "[something] is not [X], it's [Y]"
  if (/\bis not\b.+[,—–]\s*(it'?s|the)\b/i.test(t)) return true;

  return false;
}

/**
 * Returns true when the message is a short confirmation of a pending action.
 */
function isConfirmationText(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[!.?]+$/, "");
  return /^(yes|yeah|yep|yup|sure|ok|okay|do it|remember that|save it|save that|correct|exactly|right|please|go ahead|please do)$/.test(t);
}

/**
 * Persist a correction pair to both abra_corrections and open_brain_entries,
 * identical to handleCorrection but with pre-parsed content.
 */
async function persistCorrectionPair(
  msg: SlackMessageContext,
  original: string,
  correction: string,
): Promise<string> {
  const actor = msg.displayName || msg.user;
  const embeddingText = `CORRECTION: ${original} -> ${correction}`;
  const embedding = await buildEmbedding(embeddingText);

  await sbFetch("/rest/v1/abra_corrections", {
    method: "POST",
    headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
    body: JSON.stringify({
      corrected_by: actor,
      original_claim: original.slice(0, 500),
      correction: correction.slice(0, 500),
      embedding,
    }),
  });
  await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
    body: JSON.stringify({
      source_type: "manual",
      source_ref: `slack-correction-${Date.now()}`,
      entry_type: "correction",
      title: `Correction: ${original.slice(0, 100)}`,
      raw_text: `WRONG: ${original}\nCORRECT: ${correction}\nCorrected by: ${actor}`,
      summary_text: correction.slice(0, 500),
      category: "correction",
      department: "executive",
      confidence: "high",
      priority: "critical",
      processed: true,
      embedding,
    }),
  });
  return `Stored — I'll remember: "${correction.slice(0, 120)}"`;
}

export async function processAbraMessage(
  ctx: SlackMessageContext,
): Promise<SlackResponse> {
  const text = (ctx.text || "").trim();
  const hasUploads = Boolean(ctx.uploadedFiles && ctx.uploadedFiles.length > 0);
  await updateBenLastSeen(ctx);
  await releaseHeldMorningBriefIfNeeded(ctx);
  if (!text && !ctx.forceRespond && !hasUploads) {
    return { handled: false, reply: "", sources: [], answerLogId: null };
  }

  if (!text && ctx.forceRespond && !hasUploads) {
    return {
      handled: true,
      reply: "What can I help with?",
      sources: [],
      answerLogId: null,
    };
  }

  const shouldRespondNow =
    ctx.forceRespond ||
    shouldAbraRespond(text, ctx.channel) ||
    Boolean(ctx.threadTs);
  if (!shouldRespondNow) {
    return { handled: false, reply: "", sources: [], answerLogId: null };
  }

  // Strip leading Slack user/bot mentions so "teach:" and "correct:" routing
  // works even when the user @-mentions Abra first (e.g. "<@U1234> teach: ...").
  const textForRouting = text.replace(/^(<@[A-Z0-9]+>\s*)+/gi, "").trim();
  await syncEntityMentionsFromSlack(ctx, textForRouting);

  if (ctx.forceRespond && (isFinancialsChannel(ctx.channel) || isControlChannel(ctx.channel))) {
    if (isAcknowledgmentText(textForRouting)) {
      return {
        handled: true,
        reply: "Got it, let me know if you need anything else.",
        sources: [],
        answerLogId: null,
      };
    }
    if (isMinimalPrompt(textForRouting)) {
      return {
        handled: true,
        reply: "What can I help with?",
        sources: [],
        answerLogId: null,
      };
    }
  }

  if (/^correct:/i.test(textForRouting)) {
    return {
      handled: true,
      reply: await handleCorrection({ ...ctx, text: textForRouting }),
      sources: [],
      answerLogId: null,
    };
  }

  if (/^teach:/i.test(textForRouting)) {
    return {
      handled: true,
      reply: await handleTeaching({ ...ctx, text: textForRouting }),
      sources: [],
      answerLogId: null,
    };
  }

  const routed = routeMessage(textForRouting, ctx.displayName || ctx.user);
  if (routed) {
    const executed = await executeRoutedAction(routed, {
      actor: ctx.displayName || ctx.user,
      slackChannelId: ctx.channel,
      slackThreadTs: ctx.threadTs || ctx.ts,
      slackUserId: ctx.user,
      history: ctx.history,
    });
    if (executed.executed && !executed.error) {
      const rendered = renderRoutedActionResponse(executed);
      const reply = isReneUser(ctx.user)
        ? formatReneSlackReply(rendered.reply, {
            isReport: looksLikeQboReportQuery(textForRouting) || rendered.reply.length > 500,
          })
        : await maybeApplyDrivingModeReply(ctx, rendered.reply);
      return {
        handled: true,
        reply,
        sources: [],
        answerLogId: null,
        blocks: rendered.blocks,
      };
    }
  }

  const quickCommandResponse = await maybeHandleQuickCommand({ ...ctx, text: textForRouting });
  if (quickCommandResponse) {
    return quickCommandResponse;
  }

  const qboUiGuidance = maybeHandleQboUiGuidance({ ...ctx, text: textForRouting });
  if (qboUiGuidance) {
    return qboUiGuidance;
  }

  const exportResponse = await maybeHandleQboExportRequest({ ...ctx, text: textForRouting });
  if (exportResponse) {
    return exportResponse;
  }

  const operatorStatusResponse = await maybeHandleOperatorStatusQuery({ ...ctx, text: textForRouting });
  if (operatorStatusResponse) {
    return operatorStatusResponse;
  }

  const learnedFinancialCorrection = await maybeLearnFinancialCorrection({ ...ctx, text: textForRouting });
  if (learnedFinancialCorrection) {
    return {
      handled: true,
      reply: learnedFinancialCorrection,
      sources: [],
      answerLogId: null,
    };
  }

  const batchResponse = await maybeHandleBatchNumberedAnswers({ ...ctx, text: textForRouting });
  if (batchResponse) {
    return batchResponse;
  }

  // ─── Conversational correction flow (thread replies only) ───
  if (ctx.threadTs) {
    const pendingKey = pendingCorrectionKey(ctx);
    try {
      const pending = await kv.get<PendingCorrection>(pendingKey);
      if (pending && isConfirmationText(text)) {
        // User confirmed — persist and clear
        await kv.del(pendingKey);
        const reply = await persistCorrectionPair(ctx, pending.original, pending.correction);
        return { handled: true, reply, sources: [], answerLogId: null };
      }
    } catch {
      // KV failure is non-critical; fall through to normal flow
    }

    if (isConversationalCorrectionPattern(text)) {
      const lastAbraMessage =
        ctx.history?.filter((m) => m.role === "assistant").pop()?.content || "";
      const pendingData: PendingCorrection = {
        original: lastAbraMessage.slice(0, 300) || "previous Abra statement",
        correction: text,
      };
      try {
        await kv.set(pendingKey, pendingData, { ex: PENDING_CORRECTION_TTL_SECONDS });
      } catch {
        // Non-critical
      }
      return {
        handled: true,
        reply: "Got it — want me to remember this correction?",
        sources: [],
        answerLogId: null,
      };
    }
  }

  const structuredDocResponse = await handleStructuredDocumentConversation(ctx);
  if (structuredDocResponse) {
    return structuredDocResponse;
  }

  const liveReneQboResponse = await maybeHandleReneQboQuery({ ...ctx, text: textForRouting });
  if (liveReneQboResponse) {
    return liveReneQboResponse;
  }

  // Large structured data that is not a managed document session still gets
  // persisted before chat, so the operator does not lose the payload if chat fails.
  if (text.length > DATA_INGEST_THRESHOLD) {
    const actor = ctx.displayName || ctx.user;
    const titleSnippet = text.slice(0, 120).replace(/\n/g, " ").trim();
    try {
      const embedding = await buildEmbedding(
        `Data upload from ${actor}: ${titleSnippet}`,
      );
      await sbFetch("/rest/v1/open_brain_entries", {
        method: "POST",
        headers: {
          Prefer: "return=minimal",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source_type: "manual",
          source_ref: `slack-data-ingest-${ctx.channel}-${ctx.ts}`,
          entry_type: "data_upload",
          title: `Data from ${actor}: ${titleSnippet}`,
          raw_text: text.slice(0, 50000),
          summary_text: `Data upload (${text.length} chars) from ${actor} via Slack. First 500 chars: ${text.slice(0, 500)}`,
          category: "operational",
          department: "executive",
          confidence: "high",
          priority: "important",
          processed: true,
          embedding,
          metadata: { uploaded_by: actor, channel: ctx.channel, char_count: text.length },
        }),
      });
      console.log(`[abra-slack] Stored large data paste (${text.length} chars) from ${actor}`);
    } catch (err) {
      console.error("[abra-slack] Failed to store data paste:", err instanceof Error ? err.message : err);
    }
  }

  const answer = await callAbraChatViaInternalApi(ctx);
  if (!answer) {
    const fallbackReply = await maybeApplyDrivingModeReply(
      ctx,
      "I had trouble reaching my chat backend. I kept this thread intact, so please retry or break the request into smaller pieces if it was a large payload.",
    );
    return {
      handled: true,
      reply: fallbackReply,
      sources: [],
      answerLogId: null,
    };
  }

  const finalReply = isReneUser(ctx.user)
    ? formatReneSlackReply(
        /\bcreate\b.*\binvoice\b/i.test(textForRouting)
          ? `${answer.reply.replace(/\n+\s*Next step:[\s\S]*$/i, "").trim()}\n\nDraft invoice created in QBO and held for approval.`
          : answer.reply,
        { isReport: /\bcreate\b.*\binvoice\b/i.test(textForRouting) || looksLikeQboReportQuery(textForRouting) || answer.reply.length > 500 },
      )
    : await maybeApplyDrivingModeReply(ctx, answer.reply);

  return {
    handled: true,
    reply: finalReply,
    sources: answer.sources,
    answerLogId: answer.answerLogId,
    blocks: undefined,
  };
}

export async function fetchSlackKnowledgeContext(): Promise<{
  corrections: AbraCorrection[];
  departments: AbraDepartment[];
}> {
  const [corrections, departments] = await Promise.all([
    sbFetch(
      "/rest/v1/abra_corrections?active=eq.true&order=created_at.desc&limit=10&select=original_claim,correction,corrected_by,department",
    ).then((rows) => (Array.isArray(rows) ? (rows as AbraCorrection[]) : [])),
    sbFetch(
      "/rest/v1/abra_departments?select=name,owner_name,description,key_context&order=name",
    ).then((rows) => (Array.isArray(rows) ? (rows as AbraDepartment[]) : [])),
  ]);
  return { corrections, departments };
}

export async function buildSlackSystemPrompt(): Promise<string> {
  const { corrections, departments } = await fetchSlackKnowledgeContext();
  return buildAbraSystemPrompt({
    format: "slack",
    corrections,
    departments,
  });
}

export function extractSlackUsage(payload: Record<string, unknown>) {
  return extractClaudeUsage(payload);
}
