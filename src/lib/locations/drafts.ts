/**
 * Internal-only ingest store for prospective store-locator records.
 *
 * Why this exists
 * ---------------
 * `/where-to-buy` reads from the curated literal `src/data/retailers.ts`.
 * When a distributor or retailer sends us a list of stores carrying
 * USA Gummies, we don't want that list to land on the public page
 * automatically. Instead, drafts go into KV with `status="needs_review"`,
 * an operator reviews them, and a separate (future) promotion flow
 * appends accepted records to `src/data/retailers.ts` via PR.
 *
 * Hard rules locked by tests:
 *   - `ingestRows()` runs every input through `normalizeStoreLocation()`.
 *     Partial rows are rejected to the errors array with row index +
 *     reason. They never become drafts.
 *   - Drafts are deduped by a composite key derived from slug or
 *     (name + state). Re-importing the same store does not produce
 *     a second draft — it's reported as `duplicate` in the errors
 *     array so the operator can see what they already have.
 *   - `src/data/retailers.ts` is never mutated. The only writes are to
 *     two KV keys: a per-draft record and a last-error envelope.
 *   - KV failures are fail-soft on read (return empty / null) and
 *     surfaced as errors on write.
 *
 * KV schema:
 *   `locations:drafts:index`             — Array<string> (slug list, capped 1000)
 *   `locations:drafts:<slug>`            — DraftLocation
 *   `locations:drafts:last-errors`       — IngestErrorsEnvelope (most recent run)
 */
import { kv } from "@vercel/kv";

import type { RetailerLocation } from "@/data/retailers";
import { normalizeStoreLocation, type StoreLocation } from "./helpers";

export type DraftStatus = "needs_review" | "accepted" | "rejected";

export interface DraftLocation extends StoreLocation {
  /** Lifecycle marker — `needs_review` for fresh drafts. */
  status: DraftStatus;
  /** ISO when this draft was first ingested. */
  draftedAt: string;
  /** ISO when this draft was last updated. */
  updatedAt: string;
  /** Free-form note from the ingest source (e.g. "Faire batch 2026-04"). */
  ingestSource: string;
  /** Operator notes added after review. */
  reviewNote?: string;
  /** ISO when an operator last changed status / fields. Distinct from updatedAt. */
  reviewedAt?: string;
  /** Operator identifier (email / username) of the last reviewer. */
  reviewedBy?: string;
}

export const VALID_DRAFT_STATUSES: readonly DraftStatus[] = [
  "needs_review",
  "accepted",
  "rejected",
] as const;

export interface IngestErrorRow {
  /** 1-based row number from the submitted list (matches operator's view). */
  rowIndex: number;
  /** Stable machine code for the failure. */
  code:
    | "validation_failed"
    | "duplicate"
    | "missing_required"
    | "unknown";
  /** Human-readable detail. Never raw PII. */
  detail: string;
  /** The submitter-supplied slug or name (for trace). Truncated. */
  identifier: string;
}

export interface IngestErrorsEnvelope {
  recordedAt: string;
  ingestSource: string;
  errorCount: number;
  errors: IngestErrorRow[];
}

export interface IngestResult {
  ok: boolean;
  /** Number of rows that became `needs_review` drafts. */
  draftsCreated: number;
  /** Total drafts in the queue after this ingest (pre-existing + new). */
  draftsTotal: number;
  /** Per-row errors. Empty when every row was a valid new draft. */
  errors: IngestErrorRow[];
  /** Slugs of newly-created drafts in submission order. */
  createdSlugs: string[];
  ingestSource: string;
}

const KV_INDEX = "locations:drafts:index";
const KV_LAST_ERRORS = "locations:drafts:last-errors";
const INDEX_CAP = 1000;

function draftKey(slug: string): string {
  return `locations:drafts:${slug}`;
}

/**
 * Stable dedup key. Prefer the explicit slug; fall back to a
 * normalized name+state combo so rows submitted without a slug still
 * collapse correctly.
 */
function dedupKeyForRow(input: Partial<RetailerLocation>): string {
  const slug = (input.slug ?? "").trim().toLowerCase();
  if (slug) return slug;
  const name = (input.name ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  const state = (input.state ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  if (name && state) return `${name}--${state}`;
  // Without slug AND without name+state, the row is unidentifiable —
  // normalizer will reject it before dedup, but return a stable
  // string so the dedup map doesn't blow up.
  return `__partial__:${(input.slug ?? input.name ?? "").slice(0, 40)}`;
}

async function readIndex(): Promise<string[]> {
  try {
    const raw = await kv.get<string[]>(KV_INDEX);
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function writeIndex(slugs: string[]): Promise<void> {
  try {
    const unique = Array.from(new Set(slugs)).slice(-INDEX_CAP);
    await kv.set(KV_INDEX, unique);
  } catch {
    /* fail-soft */
  }
}

export async function getDraftLocation(
  slug: string,
): Promise<DraftLocation | null> {
  if (!slug) return null;
  try {
    const v = await kv.get<string | DraftLocation>(draftKey(slug));
    if (!v) return null;
    if (typeof v === "string") {
      try {
        return JSON.parse(v) as DraftLocation;
      } catch {
        return null;
      }
    }
    return v as DraftLocation;
  } catch {
    return null;
  }
}

export async function listDraftLocations(): Promise<DraftLocation[]> {
  const index = await readIndex();
  if (index.length === 0) return [];
  const drafts: DraftLocation[] = [];
  for (const slug of index) {
    const d = await getDraftLocation(slug);
    if (d) drafts.push(d);
  }
  // Newest first by `draftedAt`, falling back to slug for stability.
  return drafts.sort((a, b) => {
    const aT = Date.parse(a.draftedAt) || 0;
    const bT = Date.parse(b.draftedAt) || 0;
    if (aT !== bT) return bT - aT;
    return a.slug.localeCompare(b.slug, "en");
  });
}

export interface DraftsByStatus {
  needs_review: DraftLocation[];
  accepted: DraftLocation[];
  rejected: DraftLocation[];
}

export async function listDraftsByStatus(): Promise<DraftsByStatus> {
  const all = await listDraftLocations();
  const out: DraftsByStatus = {
    needs_review: [],
    accepted: [],
    rejected: [],
  };
  for (const d of all) {
    const bucket = out[d.status] ?? out.needs_review;
    bucket.push(d);
  }
  return out;
}

export async function readLastIngestErrors(): Promise<IngestErrorsEnvelope | null> {
  try {
    const v = await kv.get<string | IngestErrorsEnvelope>(KV_LAST_ERRORS);
    if (!v) return null;
    if (typeof v === "string") {
      try {
        return JSON.parse(v) as IngestErrorsEnvelope;
      } catch {
        return null;
      }
    }
    return v as IngestErrorsEnvelope;
  } catch {
    return null;
  }
}

async function writeLastIngestErrors(envelope: IngestErrorsEnvelope): Promise<void> {
  try {
    await kv.set(KV_LAST_ERRORS, JSON.stringify(envelope));
  } catch {
    /* fail-soft */
  }
}

interface IngestOptions {
  ingestSource?: string;
  /** Override now() for tests. Production callers omit this. */
  now?: Date;
}

/**
 * Run a list of submitted rows through normalize + dedup. Valid rows
 * land in KV with `status="needs_review"`. Errors are returned to the
 * caller AND mirrored to the `last-errors` KV envelope so the
 * /ops/locations page can show them after the response is gone.
 *
 * Pure with respect to the public retailers list — never reads or
 * mutates `src/data/retailers.ts`.
 */
export async function ingestRows(
  rows: Array<Partial<RetailerLocation>>,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const ingestSource = (options.ingestSource ?? "manual").trim() || "manual";
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();

  const errors: IngestErrorRow[] = [];
  const createdSlugs: string[] = [];

  // Snapshot the existing index + dedup against drafts already in KV.
  const existingIndex = await readIndex();
  const existingKeySet = new Set<string>();
  for (const slug of existingIndex) {
    existingKeySet.add(slug.toLowerCase());
  }

  // Track rows seen *within this batch* so duplicate-within-batch
  // submissions are caught even before they reach KV.
  const seenInBatch = new Set<string>();

  if (!Array.isArray(rows)) {
    return {
      ok: false,
      draftsCreated: 0,
      draftsTotal: existingIndex.length,
      errors: [
        {
          rowIndex: 0,
          code: "unknown",
          detail: "rows must be an array",
          identifier: "",
        },
      ],
      createdSlugs: [],
      ingestSource,
    };
  }

  let i = 0;
  for (const raw of rows) {
    i += 1;
    const identifier = (raw?.slug ?? raw?.name ?? "").toString().slice(0, 64);
    const normalized = normalizeStoreLocation(raw);
    if (!normalized) {
      errors.push({
        rowIndex: i,
        code: "missing_required",
        detail: "Row failed normalizeStoreLocation — required field missing or invalid.",
        identifier,
      });
      continue;
    }
    const dedupKey = dedupKeyForRow(normalized);
    if (seenInBatch.has(dedupKey)) {
      errors.push({
        rowIndex: i,
        code: "duplicate",
        detail: "Duplicate of an earlier row in this batch.",
        identifier,
      });
      continue;
    }
    seenInBatch.add(dedupKey);
    if (existingKeySet.has(dedupKey)) {
      errors.push({
        rowIndex: i,
        code: "duplicate",
        detail:
          "A draft already exists for this store. Update or promote the existing draft instead.",
        identifier,
      });
      continue;
    }

    const draft: DraftLocation = {
      ...normalized,
      slug: dedupKey,
      status: "needs_review",
      draftedAt: nowIso,
      updatedAt: nowIso,
      ingestSource,
    };

    try {
      await kv.set(draftKey(draft.slug), JSON.stringify(draft));
      createdSlugs.push(draft.slug);
      existingKeySet.add(dedupKey);
    } catch (err) {
      errors.push({
        rowIndex: i,
        code: "unknown",
        detail: `KV write failed: ${err instanceof Error ? err.message : String(err)}`,
        identifier,
      });
    }
  }

  if (createdSlugs.length > 0) {
    await writeIndex([...existingIndex, ...createdSlugs]);
  }

  // Always write the last-errors envelope so the /ops page surfaces the
  // most recent ingest results — including the empty-error case so
  // operators can see "last ingest had zero errors."
  const envelope: IngestErrorsEnvelope = {
    recordedAt: nowIso,
    ingestSource,
    errorCount: errors.length,
    errors,
  };
  await writeLastIngestErrors(envelope);

  const draftsTotal =
    (await readIndex()).filter((s) => Boolean(s)).length;
  return {
    ok: errors.length === 0 || createdSlugs.length > 0,
    draftsCreated: createdSlugs.length,
    draftsTotal,
    errors,
    createdSlugs,
    ingestSource,
  };
}

// ---- Review actions ---------------------------------------------------

export type DraftUpdateError =
  | { code: "not_found"; message: string }
  | { code: "invalid_status"; message: string }
  | { code: "validation_failed"; message: string }
  | { code: "no_changes"; message: string };

export interface DraftUpdatePatch {
  /** New lifecycle status. Must be one of the VALID_DRAFT_STATUSES. */
  status?: DraftStatus;
  /** Operator review note. Pass an empty string to clear. */
  reviewNote?: string;
  /**
   * Optional corrections to a subset of the store fields. Each corrected
   * draft is re-validated through `normalizeStoreLocation()` AFTER merge —
   * any update that would invalidate the record is rejected.
   */
  fieldCorrections?: Partial<StoreLocation>;
  /** Operator identifier (email / username) for the audit trail. */
  reviewedBy?: string;
}

const ALLOWED_FIELD_KEYS: ReadonlySet<keyof StoreLocation> = new Set([
  "name",
  "address",
  "cityStateZip",
  "state",
  "lat",
  "lng",
  "mapX",
  "mapY",
  "mapsUrl",
  "channel",
  "storeType",
  "website",
  "note",
]);

/**
 * Apply an operator review patch to a draft. Pure-ish (KV write is the
 * only side effect; no Slack, no email, no public publish, never
 * touches src/data/retailers.ts). Returns the updated draft on
 * success, or a structured error on failure.
 *
 * Hard rules locked by tests:
 *   - status MUST be one of VALID_DRAFT_STATUSES.
 *   - field corrections must merge into a record that still passes
 *     `normalizeStoreLocation()`. Any partial / invalid corrections
 *     reject the entire patch — no half-application.
 *   - The slug is immutable. Slug-changing corrections are silently
 *     dropped (the dedup key would otherwise drift).
 *   - `updatedAt` and `reviewedAt` are stamped on every accepted
 *     update, even when only `status` or `reviewNote` changed.
 *   - Returns `no_changes` when the patch is empty (no status, no
 *     note, no field corrections) so the caller can 400.
 */
export async function updateDraftLocation(
  slug: string,
  patch: DraftUpdatePatch,
  options: { now?: Date } = {},
): Promise<{ ok: true; draft: DraftLocation } | { ok: false; error: DraftUpdateError }> {
  const existing = await getDraftLocation(slug);
  if (!existing) {
    return {
      ok: false,
      error: {
        code: "not_found",
        message: `Draft ${slug} not found in the review queue.`,
      },
    };
  }

  const hasStatus = patch.status !== undefined;
  const hasNote = patch.reviewNote !== undefined;
  const hasFieldCorrections =
    patch.fieldCorrections !== undefined &&
    Object.keys(patch.fieldCorrections).length > 0;

  if (!hasStatus && !hasNote && !hasFieldCorrections) {
    return {
      ok: false,
      error: {
        code: "no_changes",
        message: "Patch must set at least one of status, reviewNote, or fieldCorrections.",
      },
    };
  }

  // ---- Validate status ------------------------------------------------
  if (hasStatus && !VALID_DRAFT_STATUSES.includes(patch.status as DraftStatus)) {
    return {
      ok: false,
      error: {
        code: "invalid_status",
        message: `status must be one of ${VALID_DRAFT_STATUSES.join(", ")}`,
      },
    };
  }

  // ---- Apply field corrections (merge + re-normalize) ----------------
  let merged: DraftLocation = { ...existing };
  if (hasFieldCorrections) {
    const corrections = patch.fieldCorrections!;
    // Slug is immutable — silently drop any attempt.
    const safeCorrections: Partial<StoreLocation> = {};
    for (const key of Object.keys(corrections) as Array<keyof StoreLocation>) {
      if (key === "slug") continue;
      if (!ALLOWED_FIELD_KEYS.has(key)) continue;
      const value = corrections[key];
      if (value === undefined) continue;
      (safeCorrections as Record<string, unknown>)[key] = value;
    }
    const candidate: StoreLocation = { ...existing, ...safeCorrections };
    const validated = normalizeStoreLocation(candidate);
    if (!validated) {
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message:
            "Corrected draft fails normalizeStoreLocation — at least one required field is missing or invalid after the merge.",
        },
      };
    }
    merged = { ...merged, ...validated };
  }

  // ---- Apply lifecycle changes ---------------------------------------
  const now = (options.now ?? new Date()).toISOString();
  if (hasStatus) merged.status = patch.status as DraftStatus;
  if (hasNote) {
    const note = (patch.reviewNote ?? "").trim();
    if (note.length === 0) {
      delete merged.reviewNote;
    } else {
      merged.reviewNote = note.slice(0, 1000);
    }
  }
  merged.updatedAt = now;
  merged.reviewedAt = now;
  if (typeof patch.reviewedBy === "string" && patch.reviewedBy.trim().length > 0) {
    merged.reviewedBy = patch.reviewedBy.trim().slice(0, 80);
  }

  // ---- Persist --------------------------------------------------------
  await kv.set(draftKey(slug), JSON.stringify(merged));
  return { ok: true, draft: merged };
}

/** Test helper — clear all draft KV keys + the index + last-errors. */
export async function __resetDraftsForTest(): Promise<void> {
  try {
    const index = await readIndex();
    for (const slug of index) {
      await kv.set(draftKey(slug), null);
    }
    await kv.set(KV_INDEX, []);
    await kv.set(KV_LAST_ERRORS, null);
  } catch {
    /* test seam — fail-soft */
  }
}
