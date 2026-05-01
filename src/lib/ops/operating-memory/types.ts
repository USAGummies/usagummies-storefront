/**
 * Operating-Memory Transcript Saver — types.
 *
 * Implements P0-3 from `/contracts/agent-architecture-audit.md` and the §17
 * transcript/call capture rule from `/contracts/operating-memory.md`:
 *
 *   "When a substantive conversation happens (Ben + Rene call, vendor
 *    meeting, internal strategy session), the transcript or recap must be
 *    saved to Slack memory before the day ends."
 *
 * Class A only. Action slug: `open-brain.capture` (already registered in
 * `/contracts/approval-taxonomy.md` §Class A and `taxonomy.ts`).
 *
 * Hard constraints (P0-3 build spec):
 *   - No customer-facing sends.
 *   - No HubSpot stage moves.
 *   - No QBO writes.
 *   - No Shopify/cart/pricing/inventory changes.
 *   - No permissions/secrets changes.
 *   - No new org layer.
 *   - No nested bypass: this module MUST NOT emit any Class B/C/D action
 *     (taxonomy.ts §Rule 4). Capture-and-tag only.
 *
 * Doctrine references:
 *   - /contracts/operating-memory.md §"Transcript / call capture rule (§17)"
 *   - /contracts/operating-memory.md §"What Slack must capture"
 *   - /contracts/operating-memory.md §"Drift detection via Slack corrections"
 *   - /contracts/governance.md §1 #2 — every output carries source +
 *     timestamp + confidence.
 *   - /contracts/approval-taxonomy.md §Class A `open-brain.capture` —
 *     "Capture observation/summary to Open Brain with fingerprint+provenance".
 */

import type { DivisionId } from "@/lib/ops/control-plane/types";

/**
 * The five categories the transcript saver classifies content into.
 * Pulled directly from operating-memory.md §"What Slack must capture".
 *
 * - `transcript` — full or partial recap of a substantive conversation
 *   (Ben+Rene call, vendor meeting, strategy session). §17 obligation.
 * - `decision`  — an explicit policy/operational decision posted in Slack.
 * - `correction`— a Renny/Ben correction to a prior report or system
 *   output ("that figure is wrong, actual is X"). Drift-detection input.
 * - `followup`  — a captured follow-up task ("need to test wholesale tonight").
 * - `report`    — a system-generated summary (daily brief, weekly KPI)
 *   we want indexed alongside corrections for drift cycles.
 *
 * Order matters: in the classifier, these are tested in priority order so
 * a "correction-shaped decision" is filed under `correction` (the more
 * actionable bucket for drift detection).
 */
export type EntryKind =
  | "correction"
  | "decision"
  | "followup"
  | "transcript"
  | "report";

/** Source-surface identity. Required for provenance. */
export interface SourceProvenance {
  /**
   * The system that hosted the original content. Lowercase, no spaces.
   * Examples: `"slack"`, `"gmail"`, `"notion"`, `"manual"`, `"google-drive"`.
   * `"manual"` is allowed but requires `actorId` to be a real human owner
   * (Ben | Rene | Drew) — never an agent — because an agent posting
   * `manual` would defeat provenance.
   */
  sourceSystem: string;
  /**
   * Stable id within the source system. For Slack, this is the channel
   * id + ts (e.g. "C0ATF50QQ1M:1714248192.001234"). For Gmail, the
   * thread+message id. Required: dedupe and audit cite this.
   */
  sourceRef: string;
  /** Optional permalink. Not used for dedupe; included in audit citations. */
  sourceUrl?: string;
}

/**
 * Input to the saver. Provenance is REQUIRED — there is no overload that
 * lets callers skip it. This is enforced both by the type system and
 * runtime (validateInput()).
 */
export interface TranscriptCaptureInput {
  /** The text being captured (recap body, decision line, correction sentence). */
  body: string;
  /** Optional, short summary line. If absent, derived from the first line of body. */
  summaryHint?: string;
  /** Where the content originated. Required. */
  source: SourceProvenance;
  /**
   * Who originated the content. For Slack, this is the Slack user id. For
   * `manual`, must be a HumanOwner literal: "Ben" | "Rene" | "Drew".
   * Never blank.
   */
  actorId: string;
  /**
   * Type tag for the actor. `"human"` is the canonical case for §17
   * captures. `"agent"` is allowed for system-generated reports
   * (e.g. daily brief recap), but an agent-authored record CANNOT be
   * tagged `correction` — corrections must be human-originated by
   * doctrine ("Renny / Ben corrections" are the drift inputs).
   */
  actorType: "human" | "agent";
  /** ISO 8601 timestamp of when the original event happened (call ended, message posted). */
  capturedAt: string;
  /**
   * Division this capture belongs to. Required so the audit envelope and
   * downstream surfaces route to the right Slack channel. Defaults to
   * `executive-control` if the caller is unsure (§17 calls span divisions).
   */
  division: DivisionId;
  /**
   * Optional explicit kind. If omitted, classifier infers from body text.
   * Callers SHOULD omit this and let classification flow from doctrine —
   * an explicit kind is allowed for routes that already know (e.g. a
   * route called `/transcript/capture/decision`).
   */
  kindHint?: EntryKind;
  /**
   * Optional self-reported confidence 0.0–1.0. Defaults to 1.0 for
   * verbatim Slack captures (we know what was said), 0.85 for
   * agent-summarized recaps. Governance §1 #2 — every output carries
   * confidence; this field is the carrier.
   */
  confidence?: number;
  /**
   * Optional thread tag prefix per operating-memory.md §17:
   *   "general" → `transcript:<short-id>`
   *   "finance" → `transcript:<short-id>` (in #financials)
   *   "vendor"  → `transcript:vendor:<short-id>`
   * Affects only the projected `threadTag` field in the saved record.
   * No Slack post is emitted by the saver itself — that's the route's
   * choice via the existing `slack.post.audit` Class A path.
   */
  threadTagFlavor?: "general" | "finance" | "vendor";
}

/**
 * The persisted operating-memory entry. Returned to the caller and
 * indexed under fingerprint for dedupe.
 */
export interface OperatingMemoryEntry {
  /** Random uuid v4. Distinct from `fingerprint` (the dedupe key). */
  id: string;
  /**
   * Stable sha256 hex digest of (normalized body + source.sourceRef +
   * actorId + capturedAt rounded to the minute). Same input → same
   * fingerprint → de-duped. See `fingerprint.ts`.
   */
  fingerprint: string;
  kind: EntryKind;
  /** Tags used for retrieval (e.g. `decision`, `correction`, `vendor`, `pricing`). */
  tags: string[];
  /** One-line summary, never longer than 240 chars. */
  summary: string;
  /** Redacted body (secrets scrubbed before persistence). */
  body: string;
  /** Provenance. Always present. */
  source: SourceProvenance;
  actorId: string;
  actorType: "human" | "agent";
  /** When the original event happened (caller-supplied). */
  capturedAt: string;
  /** When this saver wrote the record. */
  recordedAt: string;
  division: DivisionId;
  /** §17 thread tag, e.g. `"transcript:abc123"` or `"transcript:vendor:abc123"`. */
  threadTag: string;
  /** Self-reported confidence 0..1. */
  confidence: number;
  /**
   * If the redactor scrubbed any secret-shaped substrings, the kinds it
   * matched are listed here (`["api_key", "password", ...]`). The values
   * themselves are NEVER stored. Empty array means clean input.
   */
  redactedKinds: string[];
}

/** Result returned by `captureTranscript()`. */
export interface CaptureResult {
  ok: true;
  /** "new" if persisted, "duplicate" if a record with the same fingerprint already existed. */
  status: "new" | "duplicate";
  entry: OperatingMemoryEntry;
}
