/**
 * Fingerprint — sha256 over normalized capture inputs.
 *
 * Two inputs that should de-dupe must produce the same fingerprint:
 *   - Same body (whitespace + case-normalized)
 *   - Same source.sourceRef (channel:ts pair, or thread+message id)
 *   - Same actorId
 *   - Same capturedAt rounded to the minute
 *
 * Why minute-resolution: a vendor call recap pasted twice within the
 * same minute is the same recap; pasted 5 minutes apart is treated as a
 * separate event by the operator and gets a separate record.
 *
 * The fingerprint is used as the dedupe key in the
 * `OperatingMemoryStore`. Same fingerprint → no second write.
 */

import { createHash } from "node:crypto";

import type { TranscriptCaptureInput } from "./types";

/** Lower-case + collapse whitespace. */
function normalizeBody(body: string): string {
  return body
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Round an ISO timestamp to minute resolution (still ISO format). */
function roundToMinuteIso(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso; // malformed → caller's problem; keep as-is
  t.setSeconds(0, 0);
  return t.toISOString();
}

/**
 * Build the canonical fingerprint string for an input. Kept separate
 * from `fingerprintEntry()` so tests can assert the input shape directly.
 */
export function buildFingerprintInput(input: TranscriptCaptureInput): string {
  return [
    "v1",
    normalizeBody(input.body),
    input.source.sourceSystem.trim().toLowerCase(),
    input.source.sourceRef.trim(),
    input.actorId.trim(),
    roundToMinuteIso(input.capturedAt),
  ].join("|");
}

/**
 * Compute the sha256 hex digest of the canonical fingerprint input.
 * Stable across processes and across in-memory ↔ KV storage.
 */
export function fingerprintEntry(input: TranscriptCaptureInput): string {
  const canonical = buildFingerprintInput(input);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Exposed for tests. */
export const __INTERNAL = { normalizeBody, roundToMinuteIso };
