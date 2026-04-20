/**
 * Research note capture endpoint.
 *
 * POST body:
 *   {
 *     code: "R-1" | ... | "R-7",
 *     title: string,
 *     summary: string,
 *     sources?: string[],
 *     confidence?: number,   // 0.0–1.0, defaults to 0.8
 *     capturedBy?: string,   // defaults to "claude-code"
 *   }
 *
 * Used by Claude Code sessions / Ben / Rene to drop a research
 * finding into the KV store (`research:notes`). The Research
 * Librarian reads these weekly and composes the Friday `#research`
 * digest.
 *
 * GET returns the last 30 days of notes (admin + diagnostic).
 *
 * Auth: bearer CRON_SECRET.
 */

import { NextResponse } from "next/server";

import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import {
  addResearchNote,
  listResearchNotes,
  RESEARCH_CODES,
  type ResearchCode,
} from "@/lib/ops/research-notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isResearchCode(value: string): value is ResearchCode {
  return (RESEARCH_CODES as readonly string[]).includes(value);
}

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  const url = new URL(req.url);
  const days = Number.parseInt(url.searchParams.get("days") ?? "30", 10);
  const notes = await listResearchNotes(Number.isFinite(days) ? days : 30);
  return NextResponse.json({ ok: true, count: notes.length, notes });
}

export async function POST(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const code = String(body.code ?? "").toUpperCase();
  if (!isResearchCode(code)) {
    return NextResponse.json(
      { error: `code must be one of: ${RESEARCH_CODES.join(", ")}` },
      { status: 400 },
    );
  }
  const title = typeof body.title === "string" ? body.title : "";
  const summary = typeof body.summary === "string" ? body.summary : "";
  if (!title.trim() || !summary.trim()) {
    return NextResponse.json({ error: "title and summary required" }, { status: 400 });
  }

  const note = await addResearchNote({
    code,
    title,
    summary,
    sources: Array.isArray(body.sources)
      ? (body.sources as unknown[]).filter((s): s is string => typeof s === "string")
      : undefined,
    confidence: typeof body.confidence === "number" ? body.confidence : undefined,
    capturedBy: typeof body.capturedBy === "string" ? body.capturedBy : undefined,
  });

  return NextResponse.json({ ok: true, note });
}
