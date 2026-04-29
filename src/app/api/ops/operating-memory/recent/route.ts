/**
 * GET /api/ops/operating-memory/recent
 *
 * Read-only JSON backing route for the OpenAI MCP workspace connector
 * tool `ops.operating-memory.search` (Codex's Phase 0 registry).
 * Returns recent operating-memory entries from the P0-3 transcript
 * saver's persisted store, optionally filtered by kind.
 *
 * Query params:
 *   - `kind` (optional): correction | decision | followup | transcript | report
 *     Defaults to no filter (all kinds).
 *   - `limit` (default 50, max 200): cap on entries returned.
 *
 * Auth: bearer CRON_SECRET (same convention as drift/transcript routes).
 *
 * Hard rules:
 *   - Read-only. No writes. Class A `system.read`.
 *   - Bodies are ALREADY redacted at ingest by the P0-3 saver — this
 *     route does not re-redact, but also does not re-expose unredacted
 *     content (none exists in the store).
 *   - No new approval slug, no new division.
 */

import { NextResponse } from "next/server";

import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import { operatingMemoryStore } from "@/lib/ops/operating-memory/store";
import type { EntryKind } from "@/lib/ops/operating-memory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KINDS = new Set<EntryKind>([
  "correction",
  "decision",
  "followup",
  "transcript",
  "report",
]);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, n);
}

function parseKind(raw: string | null): EntryKind | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase() as EntryKind;
  return VALID_KINDS.has(k) ? k : null;
}

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  const url = new URL(req.url);
  const kind = parseKind(url.searchParams.get("kind"));
  const limit = parseLimit(url.searchParams.get("limit"));

  try {
    const store = operatingMemoryStore();
    const entries = kind ? await store.byKind(kind, limit) : await store.recent(limit);
    return NextResponse.json({
      ok: true,
      filter: { kind: kind ?? null, limit },
      count: entries.length,
      entries: entries.map((e) => ({
        // Drop full body to reduce payload + privacy surface — summary
        // is sufficient for ChatGPT search/discovery. Caller can fetch
        // the full entry by fingerprint via a future entry-detail route
        // if needed.
        id: e.id,
        fingerprint: e.fingerprint,
        kind: e.kind,
        tags: e.tags,
        summary: e.summary,
        source: e.source,
        actorId: e.actorId,
        actorType: e.actorType,
        capturedAt: e.capturedAt,
        recordedAt: e.recordedAt,
        division: e.division,
        threadTag: e.threadTag,
        confidence: e.confidence,
        redactedKinds: e.redactedKinds,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
