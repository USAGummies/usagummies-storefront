/**
 * GET /api/ops/finance/off-grid
 *
 * Read-only off-grid quote visibility. It replays recent sales-tour booth
 * quote audit entries, loads the persisted quote payload from KV, projects
 * priced quote lines into QuoteCandidate rows, and classifies them through
 * the existing off-grid detector. No pricing logic, QBO, HubSpot, Shopify,
 * Slack, or approval state is mutated.
 */
import { kv } from "@vercel/kv";
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { auditStore } from "@/lib/ops/control-plane/stores";
import {
  buildOffGridQuotesBriefSlice,
  type QuoteCandidate,
} from "@/lib/finance/off-grid-quotes";
import {
  boothQuoteToCandidates,
  parseStoredBoothQuote,
} from "@/lib/finance/off-grid-quote-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOOTH_QUOTE_ACTION = "sales-tour.booth-quote.composed";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = clampInt(url.searchParams.get("limit"), 50, 1, 200);
  const generatedAt = new Date().toISOString();

  try {
    const entries = await auditStore().byAction(BOOTH_QUOTE_ACTION, limit);
    const candidates: QuoteCandidate[] = [];
    const skipped: Array<{
      auditId: string;
      entityId?: string;
      reason: string;
    }> = [];

    for (const entry of entries) {
      const kvKey = getKvKey(entry.after);
      if (!kvKey) {
        skipped.push({
          auditId: entry.id,
          entityId: entry.entityId,
          reason: "missing_kv_key",
        });
        continue;
      }

      const stored = await kv.get(kvKey).catch(() => null);
      const quote = parseStoredBoothQuote(stored);
      if (!quote) {
        skipped.push({
          auditId: entry.id,
          entityId: entry.entityId,
          reason: "quote_not_found_or_malformed",
        });
        continue;
      }

      const projected = boothQuoteToCandidates(
        quote,
        entry.createdAt ?? generatedAt,
      );
      candidates.push(...projected.candidates);
      if (projected.skippedReason) {
        skipped.push({
          auditId: entry.id,
          entityId: entry.entityId,
          reason: projected.skippedReason,
        });
      }
    }

    const slice = buildOffGridQuotesBriefSlice({
      candidates,
      generatedAt,
      windowDescription: `latest ${entries.length} booth quote audit entries`,
      topN: 50,
    });

    return NextResponse.json({
      ok: true,
      generatedAt,
      source: {
        auditAction: BOOTH_QUOTE_ACTION,
        limit,
        entriesRead: entries.length,
      },
      skipped,
      slice,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        code: "off_grid_read_failed",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

function getKvKey(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as { kvKey?: unknown }).kvKey;
  return typeof raw === "string" && raw.trim() ? raw : null;
}

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
