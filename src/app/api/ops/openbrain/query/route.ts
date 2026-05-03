/**
 * GET|POST /api/ops/openbrain/query
 *
 * Slack-side query into Open Brain — the operating-memory audit log
 * filtered by `action === "open-brain.capture"`. Closes audit finding
 * Missing #27.
 *
 * Today operators can capture transcripts/thoughts via the existing
 * /api/ops/transcript/capture route (transcript-saver appends a
 * `open-brain.capture` audit entry per chunk). But there's no
 * Slack-side READ surface — operators can't ask "what did I capture
 * about Buc-ee's last week?" without grepping the raw audit JSON.
 * This route is the read counterpart.
 *
 * Match strategy: substring (case-insensitive) over the capture's
 * `body` field plus tag matches. Real semantic search lives in
 * Supabase pgvector via the MCP — that's a richer surface; this
 * route is the lightweight "good enough for the brief" path.
 *
 * Body / query params:
 *   q: string                 — substring query (required)
 *   limit?: number            — max results (default 10, max 50)
 *   sinceDays?: number        — limit window (default 90 days)
 *
 * Returns:
 *   { ok, query, results: [{capturedAt, body, tags?, runId?}], total, scanned }
 *
 * Auth: session OR bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { auditStore } from "@/lib/ops/control-plane/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_SINCE_DAYS = 90;
const SCAN_AUDIT_DEPTH = 1000;

interface QueryParams {
  q: string;
  limit: number;
  sinceDays: number;
}

interface QueryResult {
  capturedAt: string;
  body: string;
  tags?: string[];
  runId?: string;
  source?: string;
}

function parseParams(req: Request, body: Record<string, unknown> | null): QueryParams | { error: string } {
  const url = new URL(req.url);
  const q =
    typeof body?.q === "string"
      ? body.q
      : url.searchParams.get("q") ?? "";
  if (!q.trim()) return { error: "q (query string) required" };

  const limitRaw =
    typeof body?.limit === "number"
      ? body.limit
      : Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Math.max(
    1,
    Math.min(MAX_LIMIT, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT),
  );

  const sinceDaysRaw =
    typeof body?.sinceDays === "number"
      ? body.sinceDays
      : Number.parseInt(url.searchParams.get("sinceDays") ?? "", 10);
  const sinceDays = Math.max(
    1,
    Math.min(
      365,
      Number.isFinite(sinceDaysRaw) ? sinceDaysRaw : DEFAULT_SINCE_DAYS,
    ),
  );

  return { q: q.trim(), limit, sinceDays };
}

function extractCaptureBody(after: unknown): {
  body: string;
  tags?: string[];
  source?: string;
} | null {
  if (!after || typeof after !== "object") return null;
  const a = after as Record<string, unknown>;
  // The transcript-saver schema uses `body` (free text). Tags + source
  // are optional metadata fields.
  const body = typeof a.body === "string" ? a.body : null;
  if (!body) return null;
  const tags = Array.isArray(a.tags)
    ? (a.tags as unknown[])
        .filter((t): t is string => typeof t === "string")
        .slice(0, 8)
    : undefined;
  const source = typeof a.source === "string" ? a.source : undefined;
  return { body, tags, source };
}

async function runQuery(params: QueryParams) {
  const recent = await auditStore().recent(SCAN_AUDIT_DEPTH);
  const sinceMs = Date.now() - params.sinceDays * 86_400_000;
  const needle = params.q.toLowerCase();

  let scanned = 0;
  const matches: QueryResult[] = [];
  for (const entry of recent) {
    if (entry.action !== "open-brain.capture") continue;
    const t = new Date(entry.createdAt).getTime();
    if (Number.isFinite(t) && t < sinceMs) continue;
    scanned += 1;

    const captured = extractCaptureBody(entry.after);
    if (!captured) continue;

    const haystack = (captured.body + " " + (captured.tags ?? []).join(" ")).toLowerCase();
    if (!haystack.includes(needle)) continue;

    matches.push({
      capturedAt: entry.createdAt,
      body: captured.body,
      tags: captured.tags,
      runId: entry.runId,
      source: captured.source,
    });
    if (matches.length >= params.limit) break;
  }

  return {
    query: params.q,
    results: matches,
    total: matches.length,
    scanned,
    sinceDays: params.sinceDays,
  };
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = parseParams(req, null);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const result = await runQuery(parsed);
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown> | null = null;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  const parsed = parseParams(req, body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const result = await runQuery(parsed);
  return NextResponse.json({ ok: true, ...result });
}

export const __INTERNAL_FOR_TESTS = { runQuery, parseParams, extractCaptureBody };
