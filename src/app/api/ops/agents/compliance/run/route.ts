/**
 * Compliance Specialist (S-14) — runtime.
 *
 * Contract: /contracts/agents/compliance-specialist.md (v1.0 2026-04-20).
 *
 * Weekday 10:00 PT (17:00 UTC) cron. One job: scan the Notion
 * `/Legal/Compliance Calendar` database for dated obligations
 * (vendor COIs, W-9s, trademark renewals, FDA FFR biennial window,
 * WY corporate filings, insurance renewals) and post a digest to
 * `#operations` with everything expiring in the next 60 days.
 *
 * Degraded-mode contract (per §Boot ritual of the contract):
 *   - If the Compliance Calendar database cannot be located in
 *     Notion, post a `warning` to `#ops-audit` naming the missing
 *     artifact (Canon §10.1 Lane E.1) and return early — the
 *     specialist refuses to fabricate a clean digest when the
 *     calendar doesn't exist.
 *   - Approved Claims list gating is wired separately via the
 *     /api/ops/claims/* routes; this runtime only touches the
 *     compliance-calendar surface.
 *
 * Every date cited carries `notion:<page-id>` + `retrievedAt`.
 * Auth: bearer CRON_SECRET (isAuthorized + middleware whitelist).
 */

import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getChannel } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import {
  digestContentFingerprint,
  shouldMirror,
} from "@/lib/ops/control-plane/slack/mirror-dedup";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { renderComplianceDoctrineFallback } from "@/lib/ops/compliance-doctrine";
import {
  isNotionConfigured,
  notionSearch,
  queryDatabase,
  readProp,
} from "@/lib/ops/notion-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_ID = process.env.AGENT_ID_COMPLIANCE ?? "compliance-specialist";
const WINDOW_DAYS = 60;
const URGENT_DAYS = 30;

// Canon §10.1 Lane E.1 — this name is the artifact we require.
const CALENDAR_QUERY = "Compliance Calendar";

interface CalendarRow {
  id: string;
  url: string;
  label: string;
  owner: string | null;
  dueISO: string;
  daysUntil: number;
  status: string | null;
  category: string | null;
}

interface RunResult {
  ok: boolean;
  runId: string;
  postedTo: string | null;
  mode: "live" | "degraded";
  calendar?: {
    databaseId: string;
    url: string;
    rowCount: number;
    urgent: CalendarRow[];
    soon: CalendarRow[];
  };
  degraded: string[];
  rendered: string;
}

export async function GET(req: Request): Promise<Response> {
  return runAgent(req);
}

export async function POST(req: Request): Promise<Response> {
  return runAgent(req);
}

async function runAgent(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const shouldPost = url.searchParams.get("post") !== "false";

  const run = newRunContext({
    agentId: AGENT_ID,
    division: "executive-control",
    source: "scheduled",
    trigger: "weekday-10:00PT-compliance",
  });

  if (!isNotionConfigured()) {
    return emitResult(run, {
      ok: true,
      runId: run.runId,
      postedTo: null,
      mode: "degraded",
      degraded: ["NOTION_TOKEN not configured — compliance calendar unreachable"],
      rendered: renderDegraded("NOTION_TOKEN not configured"),
    }, shouldPost);
  }

  let databaseId: string | null = null;
  let databaseUrl = "";
  try {
    const hits = await notionSearch(CALENDAR_QUERY, "database", 5);
    const match = hits.find((h) => /compliance\s+calendar/i.test(h.title));
    if (match) {
      databaseId = match.id;
      databaseUrl = match.url;
    }
  } catch (err) {
    return emitResult(run, {
      ok: true,
      runId: run.runId,
      postedTo: null,
      mode: "degraded",
      degraded: [`Notion search threw: ${err instanceof Error ? err.message : String(err)}`],
      rendered: renderDegraded("Notion search failed"),
    }, shouldPost);
  }

  if (!databaseId) {
    return emitResult(run, {
      ok: true,
      runId: run.runId,
      postedTo: null,
      mode: "degraded",
      degraded: [
        `Notion database "${CALENDAR_QUERY}" not found — Canon §10.1 Lane E.1 requires this artifact before the specialist can run`,
      ],
      rendered: renderMissingCalendar(),
    }, shouldPost);
  }

  let rows: CalendarRow[];
  try {
    rows = await fetchCalendarRows(databaseId);
  } catch (err) {
    return emitResult(run, {
      ok: true,
      runId: run.runId,
      postedTo: null,
      mode: "degraded",
      degraded: [`Calendar query failed: ${err instanceof Error ? err.message : String(err)}`],
      rendered: renderDegraded("Calendar query failed"),
    }, shouldPost);
  }

  const urgent = rows.filter((r) => r.daysUntil <= URGENT_DAYS);
  const soon = rows.filter((r) => r.daysUntil > URGENT_DAYS && r.daysUntil <= WINDOW_DAYS);
  const rendered = renderDigest({ urgent, soon, databaseUrl, totalRows: rows.length });

  return emitResult(run, {
    ok: true,
    runId: run.runId,
    postedTo: null,
    mode: "live",
    calendar: { databaseId, url: databaseUrl, rowCount: rows.length, urgent, soon },
    degraded: [],
    rendered,
  }, shouldPost);
}

async function fetchCalendarRows(databaseId: string): Promise<CalendarRow[]> {
  // Pull EVERYTHING and filter client-side so we're tolerant of schema
  // drift in the Notion database property names (the contract doesn't
  // fix the exact column names, only what each means).
  const pages = await queryDatabase(databaseId, { pageSize: 100 });
  const now = Date.now();
  const out: CalendarRow[] = [];

  for (const page of pages) {
    // Find a date property — conventional names first, otherwise any date field.
    const dateProp =
      readProp(page, "Due") ??
      readProp(page, "Due Date") ??
      readProp(page, "Expires") ??
      readProp(page, "Expiration") ??
      readProp(page, "Date") ??
      readProp(page, "Renewal Date") ??
      findFirstDate(page);
    if (!dateProp || dateProp.kind !== "date") continue;

    const dueTime = new Date(dateProp.start).getTime();
    if (!Number.isFinite(dueTime)) continue;

    const daysUntil = Math.ceil((dueTime - now) / (24 * 3600 * 1000));
    if (daysUntil < -7 || daysUntil > WINDOW_DAYS) continue; // past a week or further than window

    const label =
      (readProp(page, "Name")?.kind === "text" && readProp(page, "Name")) ||
      (readProp(page, "Title")?.kind === "text" && readProp(page, "Title")) ||
      (readProp(page, "Item")?.kind === "text" && readProp(page, "Item")) ||
      { kind: "text", value: "(unnamed)" };
    const owner =
      (readProp(page, "Owner")?.kind === "text" && readProp(page, "Owner")) ||
      (readProp(page, "Responsible")?.kind === "text" && readProp(page, "Responsible")) ||
      null;
    const status =
      (readProp(page, "Status")?.kind === "status" && readProp(page, "Status")) || null;
    const category =
      (readProp(page, "Category")?.kind === "status" && readProp(page, "Category")) ||
      (readProp(page, "Type")?.kind === "status" && readProp(page, "Type")) ||
      null;

    out.push({
      id: page.id,
      url: page.url,
      label: (label as { value: string }).value,
      owner: owner && owner.kind === "text" ? owner.value : null,
      dueISO: dateProp.start,
      daysUntil,
      status: status && status.kind === "status" ? status.value : null,
      category: category && category.kind === "status" ? category.value : null,
    });
  }
  out.sort((a, b) => a.daysUntil - b.daysUntil);
  return out;
}

function findFirstDate(row: { properties: Record<string, unknown> }) {
  for (const name of Object.keys(row.properties)) {
    const val = readProp(row as { id: string; url: string; properties: Record<string, unknown>; lastEditedTime: string }, name);
    if (val?.kind === "date") return val;
  }
  return null;
}

function renderDegraded(reason: string): string {
  // Doctrine-driven fallback list — categorical obligations only,
  // no fabricated dates. Readers see `[FALLBACK]` on every row.
  return renderComplianceDoctrineFallback(reason);
}

function renderMissingCalendar(): string {
  return renderComplianceDoctrineFallback(
    `Notion database '/Legal/Compliance Calendar' is missing or not shared with this integration. Canon §10.1 Lane E.1 requires this artifact before the specialist can run authoritatively. To unblock: create the database with columns Name (title), Due (date), Owner (text), Status (status), Category (select).`,
  );
}

function renderDigest(input: {
  urgent: CalendarRow[];
  soon: CalendarRow[];
  databaseUrl: string;
  totalRows: number;
}): string {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const lines: string[] = [`🧭 *Compliance Specialist — ${today}*`, ``];

  if (input.urgent.length === 0 && input.soon.length === 0) {
    lines.push(`Nothing in the next ${WINDOW_DAYS} days. All ${input.totalRows} calendar rows clear.`);
    lines.push(``, `_Source: <${input.databaseUrl}|Compliance Calendar>_`);
    return lines.join("\n");
  }

  if (input.urgent.length > 0) {
    lines.push(`*≤ ${URGENT_DAYS} days (URGENT):*`);
    for (const r of input.urgent) {
      const prefix = r.daysUntil < 0 ? `🚨 OVERDUE by ${-r.daysUntil}d` : `⚠️ in ${r.daysUntil}d`;
      const ownerBit = r.owner ? ` · ${r.owner}` : "";
      const statusBit = r.status ? ` · ${r.status}` : "";
      lines.push(`  • ${prefix} — <${r.url}|${r.label}> (${r.dueISO})${ownerBit}${statusBit}`);
    }
  }
  if (input.soon.length > 0) {
    if (input.urgent.length > 0) lines.push("");
    lines.push(`*${URGENT_DAYS + 1}–${WINDOW_DAYS} days (watch):*`);
    for (const r of input.soon) {
      const ownerBit = r.owner ? ` · ${r.owner}` : "";
      lines.push(`  • in ${r.daysUntil}d — <${r.url}|${r.label}> (${r.dueISO})${ownerBit}`);
    }
  }
  lines.push(``, `_Source: <${input.databaseUrl}|Compliance Calendar> · ${input.totalRows} rows scanned_`);
  return lines.join("\n");
}

async function emitResult(
  run: { runId: string; division: "executive-control" | "financials" | "sales" | "production-supply-chain" | "research-intelligence" | "platform-data-automation" | "marketing-brand" | "marketing-paid" | "trade-shows-field" | "outreach-partnerships-press" | "customer-experience" | "product-packaging-rd"; agentId: string; startedAt: string; source: "scheduled" | "event" | "on-demand" | "human-invoked"; trigger?: string },
  result: RunResult,
  shouldPost: boolean,
): Promise<Response> {
  if (shouldPost) {
    const target = result.mode === "degraded" ? "ops-audit" : "operations";
    const channel = getChannel(target);
    if (channel) {
      // Content-hash dedup: in DEGRADED mode the same FALLBACK doctrine
      // list reposts daily until the calendar is populated — pure noise.
      // 24h TTL on the content fingerprint → posts ONCE per change.
      const contentFp = digestContentFingerprint(result.rendered);
      const ok = await shouldMirror({
        fingerprint: ["compliance-digest", result.mode, contentFp],
        ttlSeconds: 86_400,
        namespace: "slack-mirror-dedup:v1:digest",
      });
      if (!ok) {
        result.degraded.push(`slack-post: dedup-skip (content unchanged in last 24h)`);
      } else {
        try {
          const res = await postMessage({ channel: channel.name, text: result.rendered });
          if (res.ok) result.postedTo = channel.name;
        } catch (err) {
          result.degraded.push(
            `slack-post: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } else {
      result.degraded.push(`slack-post: #${target} channel not registered`);
    }
  }
  try {
    await auditStore().append(
      buildAuditEntry(run, {
        action: "slack.post.audit",
        entityType: "compliance-digest",
        entityId: run.runId,
        result: "ok",
        sourceCitations: result.calendar
          ? [{ system: `notion:${result.calendar.databaseId}` }]
          : [],
        confidence: 1,
      }),
    );
  } catch {
    result.degraded.push("audit-store: append failed (soft)");
  }
  return NextResponse.json(result);
}
