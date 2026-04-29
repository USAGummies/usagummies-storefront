/**
 * Transcript Saver — orchestrator.
 *
 * Implements P0-3 from `/contracts/agent-architecture-audit.md` and the
 * §17 transcript/call capture rule from `/contracts/operating-memory.md`.
 *
 * This module ONLY emits Class A side effects:
 *   - `open-brain.capture`  — persist entry to operating-memory store
 *   - `slack.post.audit`    — append one audit envelope to the audit store
 *                             (pluggable; default: factory-backed audit
 *                             store + best-effort #ops-audit Slack mirror)
 *
 * It does NOT (and the test suite locks this):
 *   - send any customer-facing email,
 *   - move any HubSpot deal stage,
 *   - write any QBO entity (customer/invoice/bill/PO/JE/CoA),
 *   - touch Shopify cart, pricing, or inventory,
 *   - modify permissions, secrets, or settings,
 *   - introduce a new division, channel, or approval slug.
 *
 * Drew-owns-nothing: the saver never writes Drew as an approver and
 * never routes a capture to a Drew-owned approval lane (there are
 * none, by design).
 *
 * Auth model: this orchestrator is a library — it does not enforce auth
 * itself. The caller (e.g. the `/api/ops/transcript/capture` route) is
 * responsible for verifying CRON_SECRET via `isCronAuthorized()`.
 */

import { randomUUID } from "node:crypto";

import type { AuditStore, AuditSlackSurface } from "@/lib/ops/control-plane/audit";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { classify } from "@/lib/ops/control-plane/taxonomy";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import type { RunContext } from "@/lib/ops/control-plane/types";

import { classifyEntry } from "./classify";
import { fingerprintEntry } from "./fingerprint";
import { redactSecrets } from "./redact";
import {
  operatingMemoryStore,
  type OperatingMemoryStore,
} from "./store";
import type {
  CaptureResult,
  EntryKind,
  OperatingMemoryEntry,
  TranscriptCaptureInput,
} from "./types";

const AGENT_ID = "transcript-saver";
const ACTION_SLUG = "open-brain.capture";

/**
 * Validation errors are thrown before any side effect. The route
 * translates them to HTTP 400.
 */
export class TranscriptValidationError extends Error {
  public readonly field: string;
  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "TranscriptValidationError";
    this.field = field;
  }
}

/**
 * Defense-in-depth class guard. The saver MUST NOT use any action slug
 * that isn't Class A. We assert the registered classification of
 * `open-brain.capture` at module load — if a future taxonomy edit
 * accidentally promotes the slug, this throws on import.
 */
function assertClassA(): void {
  const spec = classify(ACTION_SLUG);
  if (!spec) {
    throw new Error(
      `transcript-saver: action slug "${ACTION_SLUG}" not registered in taxonomy. ` +
        `Register it in /contracts/approval-taxonomy.md §Class A and src/lib/ops/control-plane/taxonomy.ts.`,
    );
  }
  if (spec.class !== "A") {
    throw new Error(
      `transcript-saver: action slug "${ACTION_SLUG}" is Class ${spec.class}, but the saver is Class-A-only. ` +
        `If this is a deliberate elevation, route through approvals.ts instead — but the doctrinal answer ` +
        `is that capture-and-tag remains Class A per /contracts/approval-taxonomy.md §Class A.`,
    );
  }
}

assertClassA();

export interface CaptureDeps {
  /**
   * Operating-memory store. Defaults to the factory-backed singleton
   * (memory locally, KV on Vercel). Pass an explicit store in tests.
   */
  store?: OperatingMemoryStore;
  /**
   * Audit store. Optional — when omitted, the saver still runs but does
   * not emit an audit envelope. Production callers MUST pass the
   * factory-backed audit store from `auditStore()` so every capture is
   * observable per the no-silent-action rule (operating-memory.md
   * §"Hard rules" #5). Tests pass an in-memory fixture.
   */
  audit?: AuditStore;
  /**
   * Best-effort Slack mirror. When provided, the saver passes the audit
   * entry to `mirror()`. A failure is swallowed — the audit-store write
   * is authoritative.
   */
  auditSurface?: AuditSlackSurface | null;
  /**
   * Optional run context. If omitted, the saver mints one. Provided
   * primarily so a calling cron can carry a parent run-id through
   * multiple captures in the same tick.
   */
  run?: RunContext;
  /**
   * Clock injection for deterministic tests. Defaults to
   * `() => new Date()`.
   */
  now?: () => Date;
}

/**
 * Validate provenance and basic shape. Throws `TranscriptValidationError`
 * on the first failure so the caller can return a clean 400.
 *
 * - body is required, must be non-empty after trim, max 50KB.
 * - source.sourceSystem + source.sourceRef are required, non-blank.
 * - actorId is required, non-blank.
 * - capturedAt must parse as a date.
 * - division must be a non-blank string (typed but checked anyway).
 * - actorType must be 'human' or 'agent'.
 * - confidence (if provided) must be in [0, 1].
 * - if actorType === 'agent', kindHint cannot be 'correction' (corrections
 *   must be human-originated per drift-detection doctrine).
 */
function validateInput(input: TranscriptCaptureInput): void {
  if (!input || typeof input !== "object") {
    throw new TranscriptValidationError("input", "input is required");
  }
  if (typeof input.body !== "string" || input.body.trim() === "") {
    throw new TranscriptValidationError("body", "body is required and must be non-empty");
  }
  if (input.body.length > 50_000) {
    throw new TranscriptValidationError("body", "body exceeds 50KB cap");
  }

  const src = input.source;
  if (!src || typeof src !== "object") {
    throw new TranscriptValidationError("source", "provenance is required (operating-memory.md §17)");
  }
  if (typeof src.sourceSystem !== "string" || src.sourceSystem.trim() === "") {
    throw new TranscriptValidationError("source.sourceSystem", "source system is required");
  }
  if (typeof src.sourceRef !== "string" || src.sourceRef.trim() === "") {
    throw new TranscriptValidationError("source.sourceRef", "source ref is required (dedupe + audit cite this)");
  }

  if (typeof input.actorId !== "string" || input.actorId.trim() === "") {
    throw new TranscriptValidationError("actorId", "actorId is required");
  }
  if (input.actorType !== "human" && input.actorType !== "agent") {
    throw new TranscriptValidationError("actorType", "actorType must be 'human' or 'agent'");
  }
  if (typeof input.capturedAt !== "string" || Number.isNaN(new Date(input.capturedAt).getTime())) {
    throw new TranscriptValidationError("capturedAt", "capturedAt must be an ISO 8601 timestamp");
  }
  if (typeof input.division !== "string" || input.division.trim() === "") {
    throw new TranscriptValidationError("division", "division is required");
  }
  if (input.confidence !== undefined) {
    if (typeof input.confidence !== "number" || input.confidence < 0 || input.confidence > 1) {
      throw new TranscriptValidationError("confidence", "confidence must be a number in [0, 1]");
    }
  }

  if (input.actorType === "agent" && input.kindHint === "correction") {
    throw new TranscriptValidationError(
      "kindHint",
      "agent-authored entries cannot be 'correction' — corrections must be human-originated per drift-detection doctrine",
    );
  }

  // Manual sources require a HumanOwner literal as actorId so an agent
  // can't masquerade as a manual capture and bypass the actorType==agent
  // protections above.
  if (src.sourceSystem.trim().toLowerCase() === "manual") {
    const allowed = new Set(["Ben", "Rene", "Drew"]);
    if (!allowed.has(input.actorId)) {
      throw new TranscriptValidationError(
        "actorId",
        "for source.sourceSystem='manual', actorId must be 'Ben' | 'Rene' | 'Drew'",
      );
    }
  }
}

/**
 * Build the persisted entry from validated input. Performs redaction +
 * classification + fingerprinting. Pure: same input → same output (modulo
 * the random `id` and `recordedAt`, which are explicit dependencies).
 */
function projectEntry(
  input: TranscriptCaptureInput,
  now: Date,
): OperatingMemoryEntry {
  const redacted = redactSecrets(input.body);
  const classification = classifyEntry(redacted.text, input.kindHint);
  const fingerprint = fingerprintEntry({ ...input, body: redacted.text });

  // §17 thread tag flavor — short fingerprint prefix is the short-id.
  const shortId = fingerprint.slice(0, 8);
  const flavor = input.threadTagFlavor ?? "general";
  const threadTag = flavor === "vendor" ? `transcript:vendor:${shortId}` : `transcript:${shortId}`;

  // Derive summary: prefer explicit hint, else first 240 chars of redacted
  // body up to first newline.
  const summary = (input.summaryHint?.trim() ||
    redacted.text.split(/\n/)[0]?.slice(0, 240) ||
    redacted.text.slice(0, 240)).trim();

  // Default confidence: 1.0 for human captures, 0.85 for agent.
  const confidence =
    typeof input.confidence === "number"
      ? input.confidence
      : input.actorType === "human"
        ? 1.0
        : 0.85;

  return {
    id: randomUUID(),
    fingerprint,
    kind: classification.kind,
    tags: classification.tags,
    summary,
    body: redacted.text,
    source: { ...input.source },
    actorId: input.actorId,
    actorType: input.actorType,
    capturedAt: input.capturedAt,
    recordedAt: now.toISOString(),
    division: input.division,
    threadTag,
    confidence,
    redactedKinds: redacted.kinds,
  };
}

/**
 * Capture a single transcript / decision / correction / followup / report
 * entry into operating memory.
 *
 * Returns `{status: "new"}` if persisted, `{status: "duplicate"}` if a
 * record with the same fingerprint already exists. Either way, an audit
 * envelope is written (with `result: "ok"` for new, `result: "skipped"`
 * for duplicate) so the call is observable.
 *
 * Class A only — never throws on Class B/C/D side effect because there
 * are none in this code path. The class guard at module load
 * (`assertClassA()`) protects against future regressions.
 */
export async function captureTranscript(
  input: TranscriptCaptureInput,
  deps: CaptureDeps = {},
): Promise<CaptureResult> {
  validateInput(input);

  const now = (deps.now ?? (() => new Date()))();
  const store = deps.store ?? operatingMemoryStore();
  const run =
    deps.run ??
    newRunContext({
      agentId: AGENT_ID,
      division: input.division,
      source: "on-demand",
      trigger: `transcript:${input.source.sourceSystem}:${input.source.sourceRef}`,
    });

  const entry = projectEntry(input, now);
  const status = await store.put(entry);
  // If duplicate, return the existing record so callers see the canonical
  // body (might differ from this call's body if the original was clean
  // and this one had partial-overlap content — fingerprint normalization
  // collapses both).
  const persisted: OperatingMemoryEntry = status === "duplicate"
    ? ((await store.getByFingerprint(entry.fingerprint)) ?? entry)
    : entry;

  // Audit envelope. Per governance §1 #3 + operating-memory.md "no silent
  // action": every autonomous write produces an audit envelope.
  if (deps.audit) {
    const auditEntry = buildAuditEntry(
      run,
      {
        action: ACTION_SLUG,
        entityType: "operating-memory.entry",
        entityId: persisted.fingerprint,
        result: status === "new" ? "ok" : "skipped",
        sourceCitations: [
          {
            system: persisted.source.sourceSystem,
            id: persisted.source.sourceRef,
            url: persisted.source.sourceUrl,
          },
        ],
        confidence: persisted.confidence,
        after: status === "new"
          ? {
              id: persisted.id,
              kind: persisted.kind,
              tags: persisted.tags,
              threadTag: persisted.threadTag,
              redactedKinds: persisted.redactedKinds,
              actorType: persisted.actorType,
              actorId: persisted.actorId,
              capturedAt: persisted.capturedAt,
              summary: persisted.summary,
            }
          : { status: "duplicate", fingerprint: persisted.fingerprint },
      },
      now,
    );
    await deps.audit.append(auditEntry);
    if (deps.auditSurface) {
      try {
        await deps.auditSurface.mirror(auditEntry);
      } catch {
        // Slack mirror is best-effort. The audit store is authoritative
        // per the existing pattern in src/lib/ops/control-plane/audit.ts.
      }
    }
  }

  return { ok: true, status, entry: persisted };
}

/** Exposed for tests. */
export const __INTERNAL = {
  AGENT_ID,
  ACTION_SLUG,
  validateInput,
  projectEntry,
};

export type { CaptureResult, EntryKind, OperatingMemoryEntry, TranscriptCaptureInput };
