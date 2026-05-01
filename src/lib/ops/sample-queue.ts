/**
 * Sample-queue helpers — pure-logic shape conversion + whale detection.
 *
 * Used by `/api/ops/sample/queue` to translate the lean operator-facing
 * request body into the canonical `OrderIntent` that
 * `/api/ops/agents/sample-dispatch/dispatch` already consumes.
 *
 * This module is pure: no I/O, no env reads. Easy to test.
 */

import type { OrderIntent } from "./sample-order-dispatch";

/** Lean operator request shape. */
export interface SampleQueueRequest {
  recipient: {
    name: string;
    company?: string;
    street1: string;
    street2?: string;
    city: string;
    state: string;
    postalCode: string;
    phone?: string;
    country?: string;
  };
  /** Optional buyer role — informational, surfaced in the approval card. */
  role?: "buyer" | "broker" | "distributor" | "media" | "other";
  /** Bag count. Default 6 (one case). */
  quantity?: number;
  /** Free-form note pushed into the OrderIntent.note. */
  note?: string;
  /**
   * When true (default), open the Slack approval card. When false, skip
   * the post — useful for the UI preview that only wants classification.
   */
  post?: boolean;
}

export type WhalePriority = "whale" | "standard";

/**
 * Whale account substrings — matches against
 * `recipient.name + recipient.company + note` (case-insensitive).
 *
 * These are the accounts where a sample drop is high-stakes enough that
 * the ops surface should flag it visibly even though approval class is
 * already Class B from `requestApproval`.
 *
 * Source: `/contracts/divisions.json` whales list + recurring conversations.
 */
const WHALE_SUBSTRINGS: ReadonlyArray<string> = [
  "buc-ee",
  "buc ee",
  "bucees",
  "kehe",
  "mclane",
  "eastern national",
  "xanterra",
  "delaware north",
  "aramark",
  "compass group",
  "sodexo",
];

/**
 * Detect whether the recipient is a whale account. Used by the route to
 * tag the approval card with a `priority: "whale"` flag.
 */
export function detectSampleWhalePriority(
  req: SampleQueueRequest,
): WhalePriority {
  const haystack = [
    req.recipient?.name ?? "",
    req.recipient?.company ?? "",
    req.note ?? "",
  ]
    .join(" ")
    .toLowerCase();
  for (const needle of WHALE_SUBSTRINGS) {
    if (haystack.includes(needle)) return "whale";
  }
  return "standard";
}

/** Return-type for `validateSampleQueueRequest`. */
export type ValidateResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Structural validation. Mirrors the 5 required ship-to fields the
 * dispatch route enforces. Returns a 1-line error string on failure
 * (suitable for a 400 response body).
 */
export function validateSampleQueueRequest(
  req: SampleQueueRequest,
): ValidateResult {
  if (!req || typeof req !== "object") {
    return { ok: false, error: "request body required" };
  }
  if (!req.recipient || typeof req.recipient !== "object") {
    return { ok: false, error: "recipient required" };
  }
  const required: Array<keyof SampleQueueRequest["recipient"]> = [
    "name",
    "street1",
    "city",
    "state",
    "postalCode",
  ];
  for (const k of required) {
    const v = req.recipient[k];
    if (typeof v !== "string" || v.trim().length === 0) {
      return { ok: false, error: `recipient.${String(k)} required` };
    }
  }
  if (req.recipient.state.trim().length !== 2) {
    return {
      ok: false,
      error: "recipient.state must be a 2-letter US state code",
    };
  }
  if (req.quantity !== undefined) {
    if (typeof req.quantity !== "number" || !Number.isFinite(req.quantity)) {
      return { ok: false, error: "quantity must be a finite number" };
    }
    if (req.quantity <= 0) {
      return { ok: false, error: "quantity must be > 0" };
    }
    if (req.quantity > 36) {
      return {
        ok: false,
        error:
          "quantity > 36 — that's a master carton, not a sample. Use /api/ops/agents/sample-dispatch/dispatch directly.",
      };
    }
  }
  return { ok: true };
}

/**
 * Generate a stable-enough manual sourceId. Format:
 *   sample-queue-<unix-ms>-<3-char-rand>
 * The randomness is for human readability when two samples queue in the
 * same millisecond; it is NOT a security boundary.
 */
export function makeSampleQueueSourceId(now: number = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 5);
  return `sample-queue-${now}-${rand}`;
}

/**
 * Translate the lean request into the canonical OrderIntent. The
 * dispatch classifier handles origin/carrier/service/packaging from the
 * tags — we just have to set them right.
 *
 * Tags emitted:
 *   - "sample"     → triggers sample-origin routing in classifier
 *   - "tag:sample" → idempotent legacy alias
 *   - "queue:operator" → audit trace
 *
 * The classifier currently routes "sample" → East Coast (Drew). Per
 * Ben's 2026-04-30 directive, ALL outbound (including samples) ships
 * from Ashford until Drew is back on payroll. The route consumer
 * surfaces `classification.origin` so the operator can override before
 * approving.
 */
export function buildSampleQueueOrderIntent(
  req: SampleQueueRequest,
  opts: { now?: number; sourceId?: string } = {},
): OrderIntent {
  const sourceId = opts.sourceId ?? makeSampleQueueSourceId(opts.now);
  const quantity = req.quantity ?? 6;

  // 7.5 oz bag = ~0.55 lb mailer or 6/case = ~6 lb. Sample default is
  // 1 case (6 bags) → packagingType=case. The classifier picks mailer
  // for 1-bag drops automatically when cartons=1 + weight≤1.
  const packagingType: OrderIntent["packagingType"] =
    quantity <= 1 ? "mailer" : "case";

  const tags = ["sample", "tag:sample", "queue:operator"];
  if (req.role) tags.push(`role:${req.role}`);

  const noteParts: string[] = [];
  if (req.role) noteParts.push(`role=${req.role}`);
  if (req.note) noteParts.push(req.note);

  return {
    channel: "manual",
    sourceId,
    orderNumber: sourceId,
    tags,
    note: noteParts.join(" · ") || undefined,
    shipTo: {
      name: req.recipient.name.trim(),
      company: req.recipient.company?.trim(),
      street1: req.recipient.street1.trim(),
      street2: req.recipient.street2?.trim(),
      city: req.recipient.city.trim(),
      state: req.recipient.state.trim().toUpperCase(),
      postalCode: req.recipient.postalCode.trim(),
      country: req.recipient.country?.trim() ?? "US",
      phone: req.recipient.phone?.trim(),
    },
    packagingType,
    cartons: 1,
    // Approximate weight to help carrier selection. 1 case = ~6 lb.
    weightLbs: quantity <= 1 ? 0.55 : 6,
  };
}
