/**
 * POST /api/ops/transcript/capture
 *
 * Class A capture endpoint for the Operating-Memory Transcript Saver.
 * Implements P0-3 from `/contracts/agent-architecture-audit.md`.
 *
 * Auth: bearer CRON_SECRET via `isCronAuthorized()`. This route is the
 * cron + manual trigger surface; webhook ingestion (Slack Events API)
 * can layer on later — same library, different auth wrapper.
 *
 * Class A only — no Class B/C/D side effects. The library
 * (`captureTranscript()`) enforces this on import via `assertClassA()`.
 *
 * Body shape: see `TranscriptCaptureInput` in
 * `src/lib/ops/operating-memory/types.ts`.
 *
 * Doctrine references:
 *   - /contracts/operating-memory.md §"Transcript / call capture rule (§17)"
 *   - /contracts/approval-taxonomy.md §Class A `open-brain.capture`
 *   - /contracts/governance.md §1 #2 (every output: source + timestamp + confidence)
 */

import { NextResponse } from "next/server";

import {
  isCronAuthorized,
  unauthorized,
} from "@/lib/ops/control-plane/admin-auth";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { auditSurface } from "@/lib/ops/control-plane/slack";

import {
  TranscriptValidationError,
  captureTranscript,
} from "@/lib/ops/operating-memory/transcript-saver";
import type { TranscriptCaptureInput } from "@/lib/ops/operating-memory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const input = body as TranscriptCaptureInput;

  try {
    const result = await captureTranscript(input, {
      audit: auditStore(),
      auditSurface: auditSurface(),
    });
    return NextResponse.json({
      ok: true,
      status: result.status,
      fingerprint: result.entry.fingerprint,
      kind: result.entry.kind,
      tags: result.entry.tags,
      threadTag: result.entry.threadTag,
      redactedKinds: result.entry.redactedKinds,
      summary: result.entry.summary,
      recordedAt: result.entry.recordedAt,
    });
  } catch (err) {
    if (err instanceof TranscriptValidationError) {
      return NextResponse.json(
        { error: err.message, field: err.field },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
