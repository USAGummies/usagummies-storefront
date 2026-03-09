import { NextResponse } from "next/server";
import {
  appendStateArray,
  readState,
  readStateArray,
  readStateObject,
  readStateTail,
  isCloud,
  writeState,
} from "@/lib/ops/state";
import { getCommandCenterConfig } from "@/lib/ops/command-center-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AgentSchedule = {
  label: string;
  hour?: number;
  minute?: number;
  graceMinutes: number;
  intervalMinutes?: number;
};

type AgentIndicator = {
  level: "active" | "idle" | "error";
  label: "Active" | "Idle" | "Error";
  reason: string;
};

type SystemCheck = {
  key: string;
  label: string;
  status: "pass" | "fail" | "unknown";
  ok: boolean;
  details: string;
};

type AgentState = {
  key?: string;
  label?: string;
  lastStatus?: string;
  lastRunAt?: string;
  lastRunAtET?: string;
  lastRunDateET?: string;
  lastDurationMs?: number;
  lastError?: string;
  summary?: string;
  source?: string;
};

type StatusModel = {
  timezone?: string;
  updatedAt?: string;
  updatedAtET?: string;
  heartbeat?: {
    lastSeenAt?: string;
    source?: string;
  };
  schedule?: Record<string, AgentSchedule>;
  agents?: Record<string, AgentState>;
  recentEvents?: Array<{
    at: string;
    agent: string;
    status: string;
    summary: string;
  }>;
  selfHeal?: {
    lastRunAt?: string;
    lastActionSummary?: string;
    actions?: string[];
  };
};

// File paths only used in local-dev mode (laptop). On Vercel, state.ts reads from KV.
const HOME = process.env.HOME || "/Users/ben";
const CONFIG_DIR = `${HOME}/.config/usa-gummies-mcp`;
const COMMAND_CENTER_CONFIG = getCommandCenterConfig();

type WeekGoals = {
  weekStart: string;
  weekEnd: string;
  distributor: { target: number; conversations: number; names: string[] };
  b2b: { target: number; orders: number };
  inderbitzin: {
    status: string;
    lastContactedDate: string;
    followUpSent: boolean;
    replyReceived: boolean;
    nextAction: string;
  };
  fetchedAt: string;
  fetchedAtIso?: string;
  error?: string;
};

type FreshnessState = "fresh" | "stale" | "unknown";

type FreshnessItem = {
  key: string;
  label: string;
  state: FreshnessState;
  ageMinutes: number | null;
  staleAfterMinutes: number;
  details: string;
};

const DEFAULT_WEEK_GOALS: WeekGoals = {
  weekStart: "",
  weekEnd: "",
  distributor: { target: 2, conversations: 0, names: [] },
  b2b: { target: 7, orders: 0 },
  inderbitzin: { status: "Unknown", lastContactedDate: "", followUpSent: false, replyReceived: false, nextAction: "Check status" },
  fetchedAt: "",
  fetchedAtIso: "",
};

let weekGoalsCache: { checkedAtMs: number; data: WeekGoals } = {
  checkedAtMs: 0,
  data: DEFAULT_WEEK_GOALS,
};

let notionHealthCache: {
  checkedAtMs: number;
  ok: boolean;
  details: string;
} = {
  checkedAtMs: 0,
  ok: false,
  details: "Not checked yet",
};
const DEFAULT_SCHEDULE_PLAN: Record<string, AgentSchedule> = {
  agent7: { label: "Daily Performance Report", hour: 7, minute: 45, graceMinutes: 180 },
  agent1: { label: "B2B Researcher", hour: 8, minute: 0, graceMinutes: 240 },
  agent22: { label: "Distributor Reference Seeder", hour: 8, minute: 20, graceMinutes: 240 },
  agent2: { label: "Distributor Researcher", hour: 8, minute: 30, graceMinutes: 240 },
  agent12: { label: "Balanced Contact Verifier", hour: 8, minute: 40, graceMinutes: 240 },
  agent0: { label: "Email Audit", hour: 8, minute: 50, graceMinutes: 240 },
  agent19: { label: "Notion Master Sync", hour: 8, minute: 52, graceMinutes: 240 },
  agent18: { label: "No-Resend Guard", hour: 8, minute: 55, graceMinutes: 240 },
  agent20: { label: "Send Queue Gate", hour: 8, minute: 57, graceMinutes: 240 },
  agent3: { label: "B2B Sender", hour: 9, minute: 0, graceMinutes: 240 },
  agent4: { label: "Distributor Sender", hour: 9, minute: 15, graceMinutes: 240 },
  agent13: { label: "Quota Floor Enforcer", hour: 11, minute: 0, graceMinutes: 240 },
  agent21: { label: "Pipeline Pulse", hour: 15, minute: 30, graceMinutes: 300 },
  agent5: { label: "Follow-Up Agent", hour: 13, minute: 0, graceMinutes: 300 },
  agent6: { label: "Inbox Monitor", hour: 16, minute: 0, graceMinutes: 300 },
  agent8: { label: "Customer Learning", hour: 17, minute: 0, graceMinutes: 300 },
  agent9: { label: "Bounce Intelligence", hour: 17, minute: 15, graceMinutes: 300 },
  agent11: { label: "Revenue Attribution Forecast", hour: 17, minute: 30, graceMinutes: 300 },
  agent16: { label: "KPI Governor", hour: 17, minute: 45, graceMinutes: 300 },
  agent17: { label: "Deliverability SRE", hour: 18, minute: 0, graceMinutes: 300 },
  agent10: { label: "Self-Heal Monitor", intervalMinutes: 30, graceMinutes: 45 },
};

function etParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  const hour = Number(pick("hour") || "0");
  const minute = Number(pick("minute") || "0");
  const second = Number(pick("second") || "0");
  return {
    date: `${year}-${month}-${day}`,
    hour,
    minute,
    second,
    minutesOfDay: hour * 60 + minute,
    timestamp: `${year}-${month}-${day} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`,
  };
}

function etDateOffset(daysAhead: number) {
  const shifted = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return etParts(shifted).date;
}

function formatEtTimestamp(date: string, hour: number, minute: number) {
  return `${date} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function minutesSinceIso(iso?: string) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.floor((Date.now() - ms) / 60000);
}

function freshnessFromIso(input: {
  key: string;
  label: string;
  staleAfterMinutes: number;
  iso?: string;
  unknownDetails: string;
}): FreshnessItem {
  const ageMinutes = minutesSinceIso(input.iso);
  if (ageMinutes === null) {
    return {
      key: input.key,
      label: input.label,
      state: "unknown",
      ageMinutes: null,
      staleAfterMinutes: input.staleAfterMinutes,
      details: input.unknownDetails,
    };
  }
  const stale = ageMinutes > input.staleAfterMinutes;
  return {
    key: input.key,
    label: input.label,
    state: stale ? "stale" : "fresh",
    ageMinutes,
    staleAfterMinutes: input.staleAfterMinutes,
    details: stale
      ? `Stale (${ageMinutes} min old, SLA ${input.staleAfterMinutes} min)`
      : `Fresh (${ageMinutes} min old, SLA ${input.staleAfterMinutes} min)`,
  };
}

// Data loading is now handled by the state abstraction layer.
// All reads happen at the top of the GET handler and are passed down.

function readNotionKeyFromEnv(): string {
  // On cloud or local: prefer env var. Fallback reads local creds file.
  const envKey = String(process.env.NOTION_API_KEY || "").trim();
  if (envKey) return envKey;
  if (isCloud()) return "";
  try {
    const credsFile = `${CONFIG_DIR}/.notion-credentials`;
    const nodeFs = require("node:fs") as typeof import("node:fs");
    if (!nodeFs.existsSync(credsFile)) return "";
    const lines = nodeFs.readFileSync(credsFile, "utf8").split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("NOTION_API_KEY=")) {
        return line.slice("NOTION_API_KEY=".length).trim();
      }
    }
  } catch {
    return "";
  }
  return "";
}

async function getNotionHealth() {
  const nowMs = Date.now();
  if (nowMs - notionHealthCache.checkedAtMs < 2 * 60 * 1000) {
    return notionHealthCache;
  }
  const key = readNotionKeyFromEnv();
  if (!key) {
    notionHealthCache = {
      checkedAtMs: nowMs,
      ok: false,
      details: "Notion API key missing",
    };
    return notionHealthCache;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const res = await fetch("https://api.notion.com/v1/users/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        "Notion-Version": "2022-06-28",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      notionHealthCache = {
        checkedAtMs: nowMs,
        ok: false,
        details: `Notion API unhealthy (HTTP ${res.status})`,
      };
      return notionHealthCache;
    }
    notionHealthCache = {
      checkedAtMs: nowMs,
      ok: true,
      details: "Notion API reachable",
    };
    return notionHealthCache;
  } catch (err) {
    notionHealthCache = {
      checkedAtMs: nowMs,
      ok: false,
      details: `Notion check failed: ${String((err as Error)?.message || err).slice(0, 120)}`,
    };
    return notionHealthCache;
  } finally {
    clearTimeout(timer);
  }
}

// -- Process monitoring (laptop-only) ----------------------------------------

function parsePid(raw: string) {
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function isPidAlive(pid: number | null) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function localExecSync(cmd: string, timeout = 5000): string {
  if (isCloud()) return "";
  try {
    const exec = require("node:child_process").execSync as typeof import("node:child_process").execSync;
    return exec(cmd, { encoding: "utf8", timeout }).trim();
  } catch { return ""; }
}

function getCommandCenterRuntime(watchdogLogLines: string[]) {
  if (isCloud()) {
    return {
      healthy: false,
      verifiable: false,
      mode: "cloud" as const,
      trackedPid: null as number | null,
      trackedPidAlive: false,
      trackedPidCommand: "",
      listenerPid: null as number | null,
      listenerCommand: "",
      watchdogLogUpdatedAt: "",
      recentWatchdogLogs: [] as string[],
    };
  }

  const nodeFs = require("node:fs") as typeof import("node:fs");
  const pidFile = `${CONFIG_DIR}/command-center.pid`;
  const logFile = `${CONFIG_DIR}/command-center.log`;
  const pidRaw = nodeFs.existsSync(pidFile) ? nodeFs.readFileSync(pidFile, "utf8") : "";
  const trackedPid = parsePid(pidRaw);
  const trackedPidAlive = isPidAlive(trackedPid);
  const trackedPidCommand = trackedPid ? localExecSync(`ps -p ${trackedPid} -o command=`) : "";
  const listenerOut = localExecSync("lsof -tiTCP:4000 -sTCP:LISTEN -n -P | head -n 1");
  const listenerPid = listenerOut ? parsePid(listenerOut) : null;
  const listenerCommand = listenerPid ? localExecSync(`ps -p ${listenerPid} -o command=`) : "";

  let watchdogLogUpdatedAt = "";
  try {
    if (nodeFs.existsSync(logFile)) watchdogLogUpdatedAt = nodeFs.statSync(logFile).mtime.toISOString();
  } catch { /* */ }

  return {
    healthy: Boolean(listenerPid),
    verifiable: true,
    mode: "local" as const,
    trackedPid,
    trackedPidAlive,
    trackedPidCommand,
    listenerPid,
    listenerCommand,
    watchdogLogUpdatedAt,
    recentWatchdogLogs: watchdogLogLines,
  };
}

function readCronSection() {
  if (isCloud()) {
    return { installed: false, unknown: true, lines: ["Cloud scheduler (Vercel Cron + QStash)"] };
  }
  try {
    const raw = localExecSync("crontab -l", 8000);
    if (!raw) return { installed: false, unknown: false, lines: [] as string[] };
    const lines = raw.split("\n");
    const start = lines.findIndex((l) => l.trim() === "# >>> USA_GUMMIES_AGENTIC >>>");
    const end = lines.findIndex((l) => l.trim() === "# <<< USA_GUMMIES_AGENTIC <<<");
    if (start < 0 || end < 0 || end <= start) return { installed: false, unknown: false, lines: [] as string[] };
    return { installed: true, unknown: false, lines: lines.slice(start + 1, end).filter((l) => l.trim().length > 0) };
  } catch {
    return { installed: false, unknown: false, lines: [] as string[] };
  }
}

function computeAgentHealth(nowET: ReturnType<typeof etParts>, schedule: AgentSchedule, state?: AgentState) {
  if (!state?.lastRunAt) {
    return { level: "unknown", reason: "No run recorded yet", stale: true, minutesSinceRun: null as number | null };
  }
  const lastRunMs = Date.parse(state.lastRunAt);
  const minutesSinceRun = Number.isFinite(lastRunMs) ? Math.floor((Date.now() - lastRunMs) / 60000) : null;
  if (schedule.intervalMinutes) {
    const stale = minutesSinceRun === null ? true : minutesSinceRun > schedule.graceMinutes;
    return {
      level: stale ? "critical" : "healthy",
      reason: stale
        ? `No heartbeat in ${minutesSinceRun ?? "?"} min (grace ${schedule.graceMinutes} min)`
        : `Heartbeat OK (${minutesSinceRun ?? "?"} min ago)`,
      stale,
      minutesSinceRun,
    };
  }

  const scheduledMinutes = (schedule.hour || 0) * 60 + (schedule.minute || 0);
  const shouldHaveRunByNow = nowET.minutesOfDay >= scheduledMinutes + schedule.graceMinutes;
  const ranToday = state.lastRunDateET === nowET.date;
  const failed = state.lastStatus === "failed";
  if (failed && minutesSinceRun !== null && minutesSinceRun > 30) {
    return {
      level: "critical",
      reason: `Last run failed ${minutesSinceRun} min ago`,
      stale: true,
      minutesSinceRun,
    };
  }
  if (shouldHaveRunByNow && !ranToday) {
    return {
      level: "critical",
      reason: `Missed today's schedule (${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")} ET)`,
      stale: true,
      minutesSinceRun,
    };
  }
  if (state.lastStatus === "partial") {
    return {
      level: "warning",
      reason: "Last run completed with partial results",
      stale: false,
      minutesSinceRun,
    };
  }
  if (state.lastStatus === "running") {
    return {
      level: "warning",
      reason: "Run currently in progress",
      stale: false,
      minutesSinceRun,
    };
  }
  return {
    level: "healthy",
    reason: "On schedule",
    stale: false,
    minutesSinceRun,
  };
}

function sumByAgent(entries: any[], agent: string, mapper: (x: any) => number) {
  return entries
    .filter((x) => x?.agent === agent && (x?.status === "success" || x?.status === "partial"))
    .reduce((sum, x) => sum + mapper(x), 0);
}

function numberOrZero(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function realRepliesFromResult(result: any) {
  if (typeof result?.processedProspectReplies === "number") {
    return Math.max(0, numberOrZero(result.processedProspectReplies));
  }
  const interested = numberOrZero(result?.interested);
  const notInterested = numberOrZero(result?.notInterested);
  const bounced = numberOrZero(result?.bounced);
  const fairOrders = numberOrZero(result?.fairOrders);
  const other = numberOrZero(result?.other);
  const attentionQueued = numberOrZero(result?.attentionQueued);
  const componentTotal = interested + notInterested + bounced + fairOrders + other;
  const attentionBackfillTotal = attentionQueued + bounced;
  if (componentTotal > 0 || attentionBackfillTotal > 0) {
    return Math.max(componentTotal, attentionBackfillTotal);
  }
  return 0;
}

function sendFailuresFromResult(result: any) {
  if (typeof result?.sendFailures === "number") {
    return Math.max(0, numberOrZero(result.sendFailures));
  }
  const candidates = [
    ...(Array.isArray(result?.failures) ? result.failures : []),
    ...(Array.isArray(result?.errors) ? result.errors : []),
  ].map((x) => String(x || "").toLowerCase());
  const transportFailure = /smtp|timed out|timeout|connection|service unavailable|failed to deliver|unable to send|send failed|message rejected|\b5\d\d\b/;
  const nonDeliveryFailure = /blocked_|quota_floor_shortfall|notion_update_queued|send_intent_failed|followup_send_intent_failed/;
  return candidates.filter((x) => transportFailure.test(x) && !nonDeliveryFailure.test(x)).length;
}

function buildKpis(nowET: ReturnType<typeof etParts>, ledger: any[]) {
  const today = nowET.date;
  const todayEntries = ledger.filter((x) => x?.runDateET === today);

  const leadsCultivatedToday =
    sumByAgent(todayEntries, "agent1", (x) => Number(x?.result?.added || 0)) +
    sumByAgent(todayEntries, "agent2", (x) => Number(x?.result?.added || 0));
  const b2bEmailsToday = sumByAgent(todayEntries, "agent3", (x) => Number(x?.result?.sent || 0));
  const distributorEmailsToday = sumByAgent(todayEntries, "agent4", (x) => Number(x?.result?.sent || 0));
  const followupsToday = sumByAgent(todayEntries, "agent5", (x) => Number((x?.result?.sentB2B || 0) + (x?.result?.sentDist || 0)));
  const repliesProcessedToday = sumByAgent(todayEntries, "agent6", (x) => realRepliesFromResult(x?.result));
  const interestedRepliesToday = sumByAgent(todayEntries, "agent6", (x) => Number(x?.result?.interested || 0));
  const notInterestedRepliesToday = sumByAgent(todayEntries, "agent6", (x) => Number(x?.result?.notInterested || 0));
  const bouncedRepliesToday = sumByAgent(todayEntries, "agent6", (x) => Number(x?.result?.bounced || 0));
  const inboxScannedToday = sumByAgent(todayEntries, "agent6", (x) => Number(x?.result?.scanned || 0));
  const inboxUnmatchedToday = sumByAgent(todayEntries, "agent6", (x) => Number(x?.result?.unmatched || 0));
  const inboxUnmatchedBouncesToday = sumByAgent(todayEntries, "agent6", (x) => Number(x?.result?.unmatchedBounces || 0));
  const fairOrdersToday = sumByAgent(todayEntries, "agent6", (x) => Number(x?.result?.fairOrders || 0));
  const sendFailuresToday =
    sumByAgent(todayEntries, "agent3", (x) => sendFailuresFromResult(x?.result)) +
    sumByAgent(todayEntries, "agent4", (x) => sendFailuresFromResult(x?.result)) +
    sumByAgent(todayEntries, "agent5", (x) => sendFailuresFromResult(x?.result));
  const failedDeliveriesToday = sendFailuresToday + bouncedRepliesToday + inboxUnmatchedBouncesToday;
  const b2bFloor = COMMAND_CENTER_CONFIG.b2bSendFloorPerDay;
  const distFloor = COMMAND_CENTER_CONFIG.distributorSendFloorPerDay;
  const b2bShortfall = Math.max(0, b2bFloor - b2bEmailsToday);
  const distShortfall = Math.max(0, distFloor - distributorEmailsToday);

  const leadsCultivatedCumulative =
    sumByAgent(ledger, "agent1", (x) => Number(x?.result?.added || 0)) +
    sumByAgent(ledger, "agent2", (x) => Number(x?.result?.added || 0));
  const emailsSentCumulative =
    sumByAgent(ledger, "agent3", (x) => Number(x?.result?.sent || 0)) +
    sumByAgent(ledger, "agent4", (x) => Number(x?.result?.sent || 0)) +
    sumByAgent(ledger, "agent5", (x) => Number((x?.result?.sentB2B || 0) + (x?.result?.sentDist || 0)));
  const b2bEmailsCumulative = sumByAgent(ledger, "agent3", (x) => Number(x?.result?.sent || 0));
  const distributorEmailsCumulative = sumByAgent(ledger, "agent4", (x) => Number(x?.result?.sent || 0));
  const followupEmailsCumulative = sumByAgent(ledger, "agent5", (x) => Number((x?.result?.sentB2B || 0) + (x?.result?.sentDist || 0)));
  const repliesProcessedCumulative = sumByAgent(ledger, "agent6", (x) => realRepliesFromResult(x?.result));
  const repliesInterestedCumulative = sumByAgent(ledger, "agent6", (x) => Number(x?.result?.interested || 0));
  const repliesNotInterestedCumulative = sumByAgent(ledger, "agent6", (x) => Number(x?.result?.notInterested || 0));
  const repliesBouncedCumulative = sumByAgent(ledger, "agent6", (x) => Number(x?.result?.bounced || 0));
  const inboxScannedCumulative = sumByAgent(ledger, "agent6", (x) => Number(x?.result?.scanned || 0));
  const inboxUnmatchedCumulative = sumByAgent(ledger, "agent6", (x) => Number(x?.result?.unmatched || 0));
  const inboxUnmatchedBouncesCumulative = sumByAgent(ledger, "agent6", (x) => Number(x?.result?.unmatchedBounces || 0));
  const fairOrdersCumulative = sumByAgent(ledger, "agent6", (x) => Number(x?.result?.fairOrders || 0));
  const sendFailuresCumulative =
    sumByAgent(ledger, "agent3", (x) => sendFailuresFromResult(x?.result)) +
    sumByAgent(ledger, "agent4", (x) => sendFailuresFromResult(x?.result)) +
    sumByAgent(ledger, "agent5", (x) => sendFailuresFromResult(x?.result));
  const failedDeliveriesCumulative =
    sendFailuresCumulative + repliesBouncedCumulative + inboxUnmatchedBouncesCumulative;

  return {
    today,
    todayMetrics: {
      leadsCultivated: leadsCultivatedToday,
      b2bEmailsSent: b2bEmailsToday,
      distributorEmailsSent: distributorEmailsToday,
      followupEmailsSent: followupsToday,
      totalEmailsSent: b2bEmailsToday + distributorEmailsToday + followupsToday,
      repliesProcessed: repliesProcessedToday,
      repliesInterested: interestedRepliesToday,
      repliesNotInterested: notInterestedRepliesToday,
      repliesBounced: bouncedRepliesToday,
      inboxScanned: inboxScannedToday,
      inboxUnmatched: inboxUnmatchedToday,
      inboxUnmatchedBounces: inboxUnmatchedBouncesToday,
      failedDeliveries: failedDeliveriesToday,
      fairOrdersLogged: fairOrdersToday,
      b2bSendFloor: b2bFloor,
      distributorSendFloor: distFloor,
      b2bFloorShortfall: b2bShortfall,
      distributorFloorShortfall: distShortfall,
      floorMet: b2bShortfall === 0 && distShortfall === 0,
    },
    cumulativeMetrics: {
      leadsCultivated: leadsCultivatedCumulative,
      b2bEmailsSent: b2bEmailsCumulative,
      distributorEmailsSent: distributorEmailsCumulative,
      followupEmailsSent: followupEmailsCumulative,
      emailsSent: emailsSentCumulative,
      repliesProcessed: repliesProcessedCumulative,
      repliesInterested: repliesInterestedCumulative,
      repliesNotInterested: repliesNotInterestedCumulative,
      repliesBounced: repliesBouncedCumulative,
      inboxScanned: inboxScannedCumulative,
      inboxUnmatched: inboxUnmatchedCumulative,
      inboxUnmatchedBounces: inboxUnmatchedBouncesCumulative,
      failedDeliveries: failedDeliveriesCumulative,
      fairOrdersLogged: fairOrdersCumulative,
    },
  };
}

function buildAttentionQueue(replyQueue: any[]) {
  const items = replyQueue
    .filter((x) => x && x.status !== "resolved")
    .reverse()
    .slice(0, 100);
  const pendingCount = items.length;
  const interestedCount = items.filter((x) => x.category === "INTERESTED").length;
  const otherCount = items.filter((x) => x.category === "OTHER").length;
  const notInterestedCount = items.filter((x) => x.category === "NOT_INTERESTED").length;
  return {
    pendingCount,
    interestedCount,
    otherCount,
    notInterestedCount,
    items,
  };
}

function computeNextRunAtET(nowET: ReturnType<typeof etParts>, schedule: AgentSchedule) {
  if (schedule.intervalMinutes) {
    const interval = Math.max(1, schedule.intervalMinutes);
    const minutesNow = nowET.minutesOfDay + (nowET.second > 0 ? 1 : 0);
    const nextSlot = (Math.floor(minutesNow / interval) + 1) * interval;
    const daysAhead = Math.floor(nextSlot / (24 * 60));
    const minuteOfDay = nextSlot % (24 * 60);
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;
    return formatEtTimestamp(etDateOffset(daysAhead), hour, minute);
  }

  const hour = schedule.hour || 0;
  const minute = schedule.minute || 0;
  const scheduledMinutes = hour * 60 + minute;
  const nowMinutes = nowET.minutesOfDay + (nowET.second > 0 ? 1 : 0);
  const daysAhead = nowMinutes < scheduledMinutes ? 0 : 1;
  return formatEtTimestamp(etDateOffset(daysAhead), hour, minute);
}

function computeAgentIndicator(state: AgentState | undefined, health: ReturnType<typeof computeAgentHealth>): AgentIndicator {
  if (state?.lastStatus === "running") {
    return {
      level: "active",
      label: "Active",
      reason: "Agent execution in progress",
    };
  }

  if (state?.lastStatus === "failed" || health.level === "critical") {
    return {
      level: "error",
      label: "Error",
      reason: state?.lastError || health.reason,
    };
  }

  if (state?.lastStatus === "partial") {
    return {
      level: "idle",
      label: "Idle",
      reason: state?.lastError || health.reason || "Partial run; recovery queued",
    };
  }

  if (!state?.lastRunAt) {
    return {
      level: "idle",
      label: "Idle",
      reason: "Waiting for first run",
    };
  }

  return {
    level: "idle",
    label: "Idle",
    reason: "Waiting for next scheduled run",
  };
}

async function computeSystemStatus(input: {
  nowET: ReturnType<typeof etParts>;
  commandCenter: ReturnType<typeof getCommandCenterRuntime>;
  cronInstalled: boolean;
  cronUnknown: boolean;
  selfHealLastRunAt?: string;
  latestEventAt?: string;
  agents: Record<string, AgentState>;
}) {
  const notion = await getNotionHealth();
  const selfHealLag = minutesSinceIso(input.selfHealLastRunAt);
  const latestEventLag = minutesSinceIso(input.latestEventAt);
  const agentsWithRuns = Object.values(input.agents).filter((a) => Boolean(a?.lastRunAt)).length;

  const checks: SystemCheck[] = [
    {
      key: "dashboard",
      label: "Dashboard Process",
      status: input.commandCenter.verifiable
        ? (input.commandCenter.healthy ? "pass" : "fail")
        : "unknown",
      ok: input.commandCenter.verifiable ? input.commandCenter.healthy : false,
      details: input.commandCenter.verifiable
        ? input.commandCenter.healthy
          ? `Listening on pid ${input.commandCenter.listenerPid ?? "n/a"}`
          : "Dashboard endpoint not reachable"
        : "Cloud runtime: local process health not verifiable",
    },
    {
      key: "scheduler",
      label: "Scheduler Installed",
      status: input.cronUnknown
        ? "unknown"
        : input.cronInstalled
          ? "pass"
          : "fail",
      ok: !input.cronUnknown && input.cronInstalled,
      details: input.cronUnknown
        ? "Cloud runtime: cron block not directly inspectable"
        : input.cronInstalled
          ? "USA_GUMMIES_AGENTIC cron block found"
          : "Cron block missing",
    },
    {
      key: "notion",
      label: "Notion Master Brain",
      status: notion.ok ? "pass" : "fail",
      ok: notion.ok,
      details: notion.details,
    },
    {
      key: "selfHeal",
      label: "Self-Heal Freshness",
      status: selfHealLag !== null && selfHealLag <= 90 ? "pass" : "fail",
      ok: selfHealLag !== null && selfHealLag <= 90,
      details:
        selfHealLag === null
          ? "No self-heal run recorded"
          : `Last self-heal ${selfHealLag} min ago`,
    },
    {
      key: "activity",
      label: "Recent Agent Activity",
      status: latestEventLag !== null && latestEventLag <= 180 ? "pass" : "fail",
      ok: latestEventLag !== null && latestEventLag <= 180,
      details:
        latestEventLag === null
          ? "No recent agent event"
          : `Most recent event ${latestEventLag} min ago`,
    },
    {
      key: "coverage",
      label: "Agents With Run History",
      status: agentsWithRuns > 0 ? "pass" : "fail",
      ok: agentsWithRuns > 0,
      details: `${agentsWithRuns} of ${Object.keys(input.agents).length} agents have run history`,
    },
    {
      key: "config",
      label: "Command Center Config",
      status: COMMAND_CENTER_CONFIG.validation.ok ? "pass" : "fail",
      ok: COMMAND_CENTER_CONFIG.validation.ok,
      details: COMMAND_CENTER_CONFIG.validation.ok
        ? "Config valid"
        : COMMAND_CENTER_CONFIG.validation.errors.join("; "),
    },
  ];

  const hardFail = checks.some(
    (c) =>
      (c.key === "dashboard" || c.key === "scheduler" || c.key === "notion" || c.key === "config")
      && c.status === "fail"
  );
  const anyFailOrUnknown = checks.some((c) => c.status !== "pass");
  const level: "running" | "degraded" | "error" = hardFail
    ? "error"
    : anyFailOrUnknown
      ? "degraded"
      : "running";
  const label = level === "running" ? "RUNNING" : level === "degraded" ? "DEGRADED" : "ERROR";

  return { level, label, checks };
}

function buildOperatorControl(input: {
  now: Date;
  nowET: ReturnType<typeof etParts>;
  agents: Record<string, AgentState>;
  ledger: any[];
  kpiTuning: Record<string, any>;
}) {
  const ledger = input.ledger;
  const tuning = input.kpiTuning;
  const cutoffMs = input.now.getTime() - 24 * 60 * 60 * 1000;
  const last24h = ledger.filter((row) => {
    const runAtMs = Date.parse(String(row?.runAt || ""));
    return Number.isFinite(runAtMs) && runAtMs >= cutoffMs;
  });

  const manualRuns = last24h.filter((row) => {
    const source = String(row?.source || "").toLowerCase();
    return source === "manual" || source === "interactive";
  });
  const automatedRuns = last24h.length - manualRuns.length;
  const lastManual = manualRuns.length ? manualRuns[manualRuns.length - 1] : null;

  const replyAutoSendEnabled = String(process.env.INBOX_RESPONDER_SEND_ENABLED || "").toLowerCase() === "true";
  const noResendState = input.agents.agent18;
  const noResendLag = minutesSinceIso(noResendState?.lastRunAt);
  const noResendActive =
    noResendState?.lastStatus === "success" &&
    noResendLag !== null &&
    noResendLag <= 24 * 60;

  const trainingUpdatedAt = String(tuning?.updatedAt || "");
  const trainingUpdatedAtET = String(tuning?.updatedAtET || "");
  const trainingLag = minutesSinceIso(trainingUpdatedAt);
  const trainingFresh = trainingLag !== null && trainingLag <= 7 * 24 * 60;
  const changeNotes = Array.isArray(tuning?.changeNotes) ? tuning.changeNotes : [];

  const checks: SystemCheck[] = [
    {
      key: "manualOversight",
      label: "Manual oversight in last 24h",
      status: manualRuns.length > 0 ? "pass" : "fail",
      ok: manualRuns.length > 0,
      details:
        manualRuns.length > 0
          ? `${manualRuns.length} manual runs in last 24h`
          : "No manual run in last 24h",
    },
    {
      key: "replyLock",
      label: "Reply auto-send lock",
      status: !replyAutoSendEnabled ? "pass" : "fail",
      ok: !replyAutoSendEnabled,
      details: !replyAutoSendEnabled
        ? "Locked (draft-only queue, founder authorization required)"
        : "UNLOCKED (requires immediate review)",
    },
    {
      key: "noResend",
      label: "No-resend guard freshness",
      status: noResendActive ? "pass" : "fail",
      ok: noResendActive,
      details: noResendActive
        ? `Agent18 OK (${noResendLag ?? "?"} min ago)`
        : "Agent18 stale or failed",
    },
    {
      key: "trainingFresh",
      label: "Training profile freshness",
      status: trainingFresh ? "pass" : "fail",
      ok: trainingFresh,
      details: trainingFresh
        ? `Updated ${trainingLag} min ago`
        : trainingUpdatedAtET
          ? `Stale profile (last update ${trainingUpdatedAtET} ET)`
          : "No training profile update found",
    },
  ];

  const hardFail = checks.some((check) => !check.ok && check.key !== "manualOversight");
  const degraded = checks.some((check) => !check.ok);
  const level: "running" | "degraded" | "error" = hardFail ? "error" : degraded ? "degraded" : "running";
  const label = level === "running" ? "RUNNING" : level === "degraded" ? "DEGRADED" : "ERROR";

  return {
    level,
    label,
    owner: "Codex + Ben",
    controlMode: "Human-supervised automation",
    replyPolicy: "Agent drafts replies; Ben approves before any send.",
    checks,
    stats: {
      manualRuns24h: manualRuns.length,
      automatedRuns24h: automatedRuns,
      totalRuns24h: last24h.length,
      lastManualRunAtET: String(lastManual?.runAtET || "n/a"),
      lastManualAgent: String(lastManual?.agent || "n/a"),
      trainingUpdatedAtET: trainingUpdatedAtET || "n/a",
      trainingNotesCount: changeNotes.length,
      recentTrainingNotes: changeNotes.slice(-3).reverse(),
    },
  };
}

async function fetchWeekGoals(notionKey: string, nowET: ReturnType<typeof etParts>, ledger: any[]): Promise<WeekGoals> {
  const nowMs = Date.now();
  if (nowMs - weekGoalsCache.checkedAtMs < 5 * 60 * 1000 && weekGoalsCache.data.fetchedAt) {
    return weekGoalsCache.data;
  }

  // Compute Monday–Saturday of current ET week
  const [year, month, day] = nowET.date.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  const dow = d.getUTCDay();
  const daysToMon = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d.getTime() + daysToMon * 86400000);
  const saturday = new Date(monday.getTime() + 5 * 86400000);
  const weekStart = monday.toISOString().slice(0, 10);
  const weekEnd = saturday.toISOString().slice(0, 10);

  if (!notionKey) {
    return {
      ...DEFAULT_WEEK_GOALS,
      weekStart,
      weekEnd,
      fetchedAt: nowET.timestamp,
      fetchedAtIso: new Date().toISOString(),
      error: "No Notion key",
    };
  }
  if (!COMMAND_CENTER_CONFIG.validation.ok) {
    return {
      ...DEFAULT_WEEK_GOALS,
      weekStart,
      weekEnd,
      fetchedAt: nowET.timestamp,
      fetchedAtIso: new Date().toISOString(),
      error: COMMAND_CENTER_CONFIG.validation.errors.join("; "),
    };
  }

  const headers = {
    Authorization: `Bearer ${notionKey}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    // 1. Distributors who replied (conversation started)
    const distRes = await fetch(`https://api.notion.com/v1/databases/${COMMAND_CENTER_CONFIG.distributorProspectsDbId}/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        filter: { property: "Reply Received", checkbox: { equals: true } },
        page_size: 30,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    let conversationNames: string[] = [];
    if (distRes.ok) {
      const distData = await distRes.json();
      conversationNames = (distData.results || []).map((p: any) => {
        return p?.properties?.["Company Name"]?.title?.[0]?.plain_text || "Unknown";
      });
    }

    // 2. Inderbitzin page
    const inderRes = await fetch(`https://api.notion.com/v1/pages/${COMMAND_CENTER_CONFIG.inderbitzinPageId}`, {
      method: "GET",
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    let inderStatus = "Unknown";
    let inderLastContact = "";
    let inderFollowUpSent = false;
    let inderReplyReceived = false;
    let nextAction = "Check status";
    if (inderRes.ok) {
      const inderData = await inderRes.json();
      const props = inderData.properties || {};
      inderStatus = props?.["Status"]?.select?.name || "Unknown";
      inderLastContact = props?.["Date First Contacted"]?.date?.start || "";
      inderFollowUpSent = Boolean(props?.["Date Follow-Up Sent"]?.date?.start);
      inderReplyReceived = Boolean(props?.["Reply Received"]?.checkbox);
      if (inderReplyReceived) {
        const replySummary = String(props?.["Reply Summary"]?.rich_text?.[0]?.plain_text || "").toLowerCase();
        nextAction = replySummary.includes("not interested")
          ? "Replied - Not Interested. Review and archive."
          : "⚡ REPLY RECEIVED — Take over immediately!";
      } else if (inderFollowUpSent) {
        nextAction = "Follow-up sent. Awaiting reply. Consider calling directly.";
      } else {
        nextAction = "⚠️ Send follow-up TODAY (initial outreach sent 2/22)";
      }
    }

    // 3. B2B orders this week from run ledger
    const weekOrders = ledger
      .filter((x: any) => { const d = String(x?.runDateET || ""); return d >= weekStart && d <= weekEnd; })
      .reduce((sum: number, x: any) => sum + Number(x?.result?.fairOrders || 0), 0);

    const result: WeekGoals = {
      weekStart,
      weekEnd,
      distributor: { target: 2, conversations: conversationNames.length, names: conversationNames },
      b2b: { target: 7, orders: weekOrders },
      inderbitzin: { status: inderStatus, lastContactedDate: inderLastContact, followUpSent: inderFollowUpSent, replyReceived: inderReplyReceived, nextAction },
      fetchedAt: nowET.timestamp,
      fetchedAtIso: new Date().toISOString(),
    };
    weekGoalsCache = { checkedAtMs: nowMs, data: result };
    return result;
  } catch (err) {
    return {
      ...weekGoalsCache.data,
      weekStart,
      weekEnd,
      fetchedAt: nowET.timestamp,
      fetchedAtIso: new Date().toISOString(),
      error: String((err as Error)?.message || err).slice(0, 200),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  // ── Pre-load all state (KV on Vercel, filesystem on laptop) ──────────
  const [status, ledger, replyQueue, kpiTuning, engineLogLines, watchdogLogLines] =
    await Promise.all([
      readState<StatusModel>("system-status", {}),
      readStateArray("run-ledger"),
      readStateArray("reply-queue"),
      readStateObject("kpi-tuning"),
      readStateTail("engine-log", 120),
      readStateTail("command-center-log", 20),
    ]);

  const now = new Date();
  const nowET = etParts(now);
  const schedule = { ...DEFAULT_SCHEDULE_PLAN, ...(status.schedule || {}) };
  const agents = status.agents || {};

  const agentRows = Object.entries(schedule).map(([key, scheduleEntry]) => {
    const state = agents[key];
    const health = computeAgentHealth(nowET, scheduleEntry, state);
    const indicator = computeAgentIndicator(state, health);
    const nextRunAtET = computeNextRunAtET(nowET, scheduleEntry);
    return {
      key,
      label: scheduleEntry.label || state?.label || key,
      schedule: scheduleEntry,
      state: state || null,
      health,
      indicator,
      nextRunAtET,
    };
  });

  const criticalCount = agentRows.filter((x) => x.health.level === "critical").length;
  const warningCount = agentRows.filter((x) => x.health.level === "warning").length;
  const indicatorCounts = {
    active: agentRows.filter((x) => x.indicator.level === "active").length,
    idle: agentRows.filter((x) => x.indicator.level === "idle").length,
    error: agentRows.filter((x) => x.indicator.level === "error").length,
  };
  const overall =
    criticalCount > 0 ? "critical" : warningCount > 0 ? "warning" : "healthy";

  const cron = readCronSection();
  const commandCenter = getCommandCenterRuntime(watchdogLogLines);
  const kpis = buildKpis(nowET, ledger);
  const attentionQueue = buildAttentionQueue(replyQueue);
  const notionKeyForGoals = readNotionKeyFromEnv();
  const weekGoals = await fetchWeekGoals(notionKeyForGoals, nowET, ledger);
  const recentEvents = (status.recentEvents || []).slice(-20).reverse();
  const latestEventAt = status.recentEvents?.length
    ? status.recentEvents[status.recentEvents.length - 1]?.at
    : "";
  const systemStatus = await computeSystemStatus({
    nowET,
    commandCenter,
    cronInstalled: cron.installed,
    cronUnknown: Boolean((cron as { unknown?: boolean }).unknown),
    selfHealLastRunAt: status.selfHeal?.lastRunAt,
    latestEventAt,
    agents,
  });
  const operatorControl = buildOperatorControl({
    now,
    nowET,
    agents,
    ledger,
    kpiTuning: kpiTuning as Record<string, any>,
  });

  const newestQueueAtIso = (replyQueue || []).reduce((latest: string, item: any) => {
    const candidate = String(item?.queuedAt || item?.receivedAt || "");
    const candidateMs = Date.parse(candidate);
    const latestMs = Date.parse(latest);
    if (!Number.isFinite(candidateMs)) return latest;
    if (!Number.isFinite(latestMs) || candidateMs > latestMs) return candidate;
    return latest;
  }, "");
  const freshness: FreshnessItem[] = [
    freshnessFromIso({
      key: "heartbeat",
      label: "System heartbeat",
      staleAfterMinutes: 15,
      iso: status.heartbeat?.lastSeenAt,
      unknownDetails: "No heartbeat timestamp available",
    }),
    freshnessFromIso({
      key: "selfHeal",
      label: "Self-heal monitor",
      staleAfterMinutes: 90,
      iso: status.selfHeal?.lastRunAt,
      unknownDetails: "No self-heal timestamp available",
    }),
    freshnessFromIso({
      key: "agentEvents",
      label: "Recent agent events",
      staleAfterMinutes: 180,
      iso: latestEventAt,
      unknownDetails: "No agent events available",
    }),
    freshnessFromIso({
      key: "replyQueue",
      label: "Reply queue freshness",
      staleAfterMinutes: 60,
      iso: newestQueueAtIso,
      unknownDetails:
        attentionQueue.pendingCount > 0
          ? "Pending queue items have no parseable timestamp"
          : "No pending queue items",
    }),
    freshnessFromIso({
      key: "weekGoals",
      label: "Week goals sync",
      staleAfterMinutes: 10,
      iso: weekGoals.fetchedAtIso,
      unknownDetails: "Week goals sync timestamp unavailable",
    }),
  ];

  const paths = isCloud()
    ? {
      statusFile: "kv://usag:system-status",
      logFile: "kv://usag:engine-log",
      commandCenterPidFile: "kv://usag:command-center-pid",
      commandCenterLogFile: "kv://usag:command-center-log",
    }
    : {
      statusFile: `${CONFIG_DIR}/agentic-system-status.json`,
      logFile: `${CONFIG_DIR}/agentic-engine.log`,
      commandCenterPidFile: `${CONFIG_DIR}/command-center.pid`,
      commandCenterLogFile: `${CONFIG_DIR}/command-center.log`,
    };

  const statusSnapshot = {
    at: now.toISOString(),
    generatedAtET: nowET.timestamp,
    level: systemStatus.level,
    label: systemStatus.label,
    checks: systemStatus.checks,
    overall,
    counts: {
      critical: criticalCount,
      warning: warningCount,
      healthy: agentRows.filter((x) => x.health.level === "healthy").length,
      unknown: agentRows.filter((x) => x.health.level === "unknown").length,
    },
  };
  const previousStatus = await readState<any>("command-center-status-cache", null);
  const shouldLogTransition =
    !previousStatus
    || previousStatus.level !== statusSnapshot.level
    || previousStatus.overall !== statusSnapshot.overall
    || previousStatus.counts?.critical !== statusSnapshot.counts.critical
    || previousStatus.counts?.warning !== statusSnapshot.counts.warning;
  await writeState("command-center-status-cache", statusSnapshot);
  if (shouldLogTransition) {
    await appendStateArray("command-center-status-log", [statusSnapshot], 1000);
  }

  return NextResponse.json({
    generatedAt: now.toISOString(),
    generatedAtET: nowET.timestamp,
    overall,
    counts: {
      critical: criticalCount,
      warning: warningCount,
      healthy: agentRows.filter((x) => x.health.level === "healthy").length,
      unknown: agentRows.filter((x) => x.health.level === "unknown").length,
    },
    indicatorCounts,
    proofOfLife: {
      heartbeatAt: status.heartbeat?.lastSeenAt || "",
      heartbeatSource: status.heartbeat?.source || "",
      selfHealLastRunAt: status.selfHeal?.lastRunAt || "",
      selfHealSummary: status.selfHeal?.lastActionSummary || "",
    },
    cron,
    agents: agentRows,
    recentEvents,
    selfHeal: status.selfHeal || {},
    kpis,
    attentionQueue,
    weekGoals,
    systemStatus,
    operatorControl,
    commandCenter,
    logs: engineLogLines,
    paths,
    freshness,
    statusTransitionLogged: shouldLogTransition,
    environment: isCloud() ? "cloud" : "local",
  });
}
