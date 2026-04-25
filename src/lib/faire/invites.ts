/**
 * Internal Faire Direct invite review queue.
 *
 * Why this exists
 * ---------------
 * Faire Direct orders carry 0% commission vs. the marketplace's
 * standard rate. The strategic move is to invite retailers we already
 * have a relationship with into Faire Direct so future POs flow
 * through the 0%-commission channel.
 *
 * BUT — every invite is a Class B `faire-direct.invite` per
 * /contracts/approval-taxonomy.md and /contracts/agents/faire-specialist.md.
 * No agent auto-sends invites; an operator approves each one. This
 * Phase 1 build stages the candidates in KV as `needs_review`. A
 * later phase wires the approved click to the real Faire send (or to
 * a manual hand-off if Faire's API doesn't support invite send).
 *
 * Hard rules locked by tests:
 *   - `ingestInviteRows()` runs every input through `validateInvite()`.
 *     Invalid rows go into the `errors[]` envelope with row index +
 *     reason — they never become queue records.
 *   - Duplicates (within batch + against existing queue) are dedup'd
 *     by lowercased email. Re-importing the same retailer never
 *     produces a second row.
 *   - **No email / Faire invite is sent.** Phase 1 is review-only.
 *     The module imports nothing from Gmail / Slack / Faire client.
 *   - When `FAIRE_ACCESS_TOKEN` is missing, `isFaireConfigured()`
 *     returns false and the dashboard surfaces a degraded banner.
 *     Queue ingest still works — the reason to stage candidates
 *     doesn't depend on the token, only the eventual send does.
 *
 * KV schema:
 *   `faire:invites:index`           — Array<string> invite ids (cap 1000)
 *   `faire:invites:<id>`            — FaireInviteRecord
 */
import { kv } from "@vercel/kv";

// Re-export the existing isFaireConfigured() so the dashboard has one
// import surface for the degraded check.
export { isFaireConfigured } from "@/lib/ops/faire-client";

export type FaireInviteStatus =
  | "needs_review"
  | "approved"
  | "sent"
  | "rejected";

export const VALID_FAIRE_INVITE_STATUSES: readonly FaireInviteStatus[] = [
  "needs_review",
  "approved",
  "sent",
  "rejected",
] as const;

export interface FaireInviteCandidate {
  retailerName: string;
  buyerName?: string;
  email: string;
  city?: string;
  state?: string;
  source: string;
  notes?: string;
  hubspotContactId?: string;
}

export interface FaireInviteRecord extends FaireInviteCandidate {
  /** Stable id derived from lowercased email — also the dedup key. */
  id: string;
  status: FaireInviteStatus;
  queuedAt: string;
  updatedAt: string;
  /** ISO of the most recent operator review (set by Phase 2 review actions). */
  reviewedAt?: string;
  reviewedBy?: string;
  /** Operator notes added after review. */
  reviewNote?: string;
}

export interface FaireInviteIngestErrorRow {
  rowIndex: number;
  code: "validation_failed" | "duplicate" | "unknown";
  detail: string;
  /** Submitter-supplied identifier for trace; truncated. */
  identifier: string;
}

export interface FaireInviteIngestResult {
  ok: boolean;
  /** Number of candidates that became `needs_review` records. */
  queued: number;
  /** Total invites in the queue after this ingest. */
  totalInQueue: number;
  errors: FaireInviteIngestErrorRow[];
  createdIds: string[];
}

const KV_INDEX = "faire:invites:index";
const INDEX_CAP = 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function inviteKey(id: string): string {
  return `faire:invites:${id}`;
}

/**
 * Stable id derived from email (lowercased + URL-friendly). Same email
 * always produces the same id, which is the dedup key.
 */
export function inviteIdFromEmail(email: string): string {
  return email.trim().toLowerCase().replace(/[^a-z0-9.@_+-]/g, "");
}

// ----- Validation ----------------------------------------------------

export type ValidateResult =
  | { ok: true; candidate: FaireInviteCandidate }
  | { ok: false; reason: string };

export function validateInvite(
  input: Partial<FaireInviteCandidate> | null | undefined,
): ValidateResult {
  if (!input || typeof input !== "object") {
    return { ok: false, reason: "input must be an object" };
  }
  const retailerName = (input.retailerName ?? "").trim();
  const email = (input.email ?? "").trim();
  const source = (input.source ?? "").trim();
  if (!retailerName) {
    return { ok: false, reason: "retailerName is required" };
  }
  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, reason: "email is required and must be a valid email" };
  }
  if (!source) {
    return { ok: false, reason: "source is required (e.g. 'wholesale-page', 'faire-batch-2026-04')" };
  }
  const candidate: FaireInviteCandidate = {
    retailerName,
    email: email.toLowerCase(),
    source,
  };
  if (typeof input.buyerName === "string" && input.buyerName.trim().length > 0) {
    candidate.buyerName = input.buyerName.trim();
  }
  if (typeof input.city === "string" && input.city.trim().length > 0) {
    candidate.city = input.city.trim();
  }
  if (typeof input.state === "string" && input.state.trim().length > 0) {
    candidate.state = input.state.trim();
  }
  if (typeof input.notes === "string" && input.notes.trim().length > 0) {
    candidate.notes = input.notes.trim().slice(0, 1000);
  }
  if (
    typeof input.hubspotContactId === "string" &&
    input.hubspotContactId.trim().length > 0
  ) {
    candidate.hubspotContactId = input.hubspotContactId.trim();
  }
  return { ok: true, candidate };
}

// ----- KV CRUD --------------------------------------------------------

async function readIndex(): Promise<string[]> {
  try {
    const v = await kv.get<string[]>(KV_INDEX);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function writeIndex(ids: string[]): Promise<void> {
  try {
    const unique = Array.from(new Set(ids)).slice(-INDEX_CAP);
    await kv.set(KV_INDEX, unique);
  } catch {
    /* fail-soft */
  }
}

export async function getInvite(id: string): Promise<FaireInviteRecord | null> {
  if (!id) return null;
  try {
    const v = await kv.get<string | FaireInviteRecord>(inviteKey(id));
    if (!v) return null;
    if (typeof v === "string") {
      try {
        return JSON.parse(v) as FaireInviteRecord;
      } catch {
        return null;
      }
    }
    return v as FaireInviteRecord;
  } catch {
    return null;
  }
}

export async function listInvites(): Promise<FaireInviteRecord[]> {
  const ids = await readIndex();
  if (ids.length === 0) return [];
  const out: FaireInviteRecord[] = [];
  for (const id of ids) {
    const r = await getInvite(id);
    if (r) out.push(r);
  }
  // Newest first.
  return out.sort((a, b) => {
    const aT = Date.parse(a.queuedAt) || 0;
    const bT = Date.parse(b.queuedAt) || 0;
    if (aT !== bT) return bT - aT;
    return a.id.localeCompare(b.id, "en");
  });
}

export interface InvitesByStatus {
  needs_review: FaireInviteRecord[];
  approved: FaireInviteRecord[];
  sent: FaireInviteRecord[];
  rejected: FaireInviteRecord[];
}

export async function listInvitesByStatus(): Promise<InvitesByStatus> {
  const all = await listInvites();
  const out: InvitesByStatus = {
    needs_review: [],
    approved: [],
    sent: [],
    rejected: [],
  };
  for (const r of all) {
    const bucket = out[r.status] ?? out.needs_review;
    bucket.push(r);
  }
  return out;
}

// ----- Ingest --------------------------------------------------------

interface IngestOptions {
  now?: Date;
}

/**
 * Stage submitted rows as `needs_review` invite candidates. Returns
 * a `{ queued, errors[] }` envelope so the route can map to HTTP
 * codes cleanly.
 *
 * Pure with respect to email/Faire: never sends an invite, never
 * touches Gmail or the Faire client.
 */
export async function ingestInviteRows(
  rows: Array<Partial<FaireInviteCandidate>>,
  options: IngestOptions = {},
): Promise<FaireInviteIngestResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const errors: FaireInviteIngestErrorRow[] = [];
  const createdIds: string[] = [];

  if (!Array.isArray(rows)) {
    return {
      ok: false,
      queued: 0,
      totalInQueue: (await readIndex()).length,
      errors: [
        {
          rowIndex: 0,
          code: "unknown",
          detail: "rows must be an array",
          identifier: "",
        },
      ],
      createdIds: [],
    };
  }

  const existingIndex = await readIndex();
  const existingIdSet = new Set(existingIndex.map((s) => s.toLowerCase()));
  const seenInBatch = new Set<string>();

  let i = 0;
  for (const raw of rows) {
    i += 1;
    const identifier = (raw?.email ?? raw?.retailerName ?? "")
      .toString()
      .slice(0, 64);
    const validation = validateInvite(raw);
    if (!validation.ok) {
      errors.push({
        rowIndex: i,
        code: "validation_failed",
        detail: validation.reason,
        identifier,
      });
      continue;
    }
    const id = inviteIdFromEmail(validation.candidate.email);
    if (seenInBatch.has(id)) {
      errors.push({
        rowIndex: i,
        code: "duplicate",
        detail: "Duplicate email earlier in this batch.",
        identifier,
      });
      continue;
    }
    seenInBatch.add(id);
    if (existingIdSet.has(id)) {
      errors.push({
        rowIndex: i,
        code: "duplicate",
        detail:
          "An invite for this email is already in the queue. Update it via the review action instead of re-ingesting.",
        identifier,
      });
      continue;
    }

    const record: FaireInviteRecord = {
      ...validation.candidate,
      id,
      status: "needs_review",
      queuedAt: nowIso,
      updatedAt: nowIso,
    };
    try {
      await kv.set(inviteKey(id), JSON.stringify(record));
      createdIds.push(id);
      existingIdSet.add(id);
    } catch (err) {
      errors.push({
        rowIndex: i,
        code: "unknown",
        detail: `KV write failed: ${err instanceof Error ? err.message : String(err)}`,
        identifier,
      });
    }
  }

  if (createdIds.length > 0) {
    await writeIndex([...existingIndex, ...createdIds]);
  }

  const totalInQueue = (await readIndex()).filter((s) => Boolean(s)).length;
  return {
    ok: errors.length === 0 || createdIds.length > 0,
    queued: createdIds.length,
    totalInQueue,
    errors,
    createdIds,
  };
}

// ---- Phase 2 review actions -----------------------------------------

/**
 * Status values an operator may set via the review route. `"sent"` is
 * intentionally NOT in this set — sent transitions only happen inside
 * the future send-on-approve closer (Class B `faire-direct.invite`).
 */
export const REVIEWABLE_STATUSES: readonly Exclude<
  FaireInviteStatus,
  "sent"
>[] = ["needs_review", "approved", "rejected"] as const;

export type InviteUpdateError =
  | { code: "not_found"; message: string }
  | { code: "invalid_status"; message: string }
  | { code: "sent_status_forbidden"; message: string }
  | { code: "validation_failed"; message: string }
  | { code: "duplicate_email"; message: string }
  | { code: "no_changes"; message: string };

export interface InviteUpdatePatch {
  status?: FaireInviteStatus;
  reviewNote?: string;
  fieldCorrections?: Partial<FaireInviteCandidate>;
  reviewedBy?: string;
}

const ALLOWED_CORRECTION_KEYS: ReadonlySet<keyof FaireInviteCandidate> = new Set(
  [
    "retailerName",
    "buyerName",
    "email",
    "city",
    "state",
    "source",
    "notes",
    "hubspotContactId",
  ],
);

/**
 * Apply an operator review patch to an invite record. KV write is the
 * only side effect — no Gmail / Slack / Faire / network call.
 *
 * Hard rules locked by tests:
 *   - status MUST be one of REVIEWABLE_STATUSES. Setting `"sent"`
 *     here is rejected with `code: "sent_status_forbidden"` so a
 *     future send closer is the only path that can flip a record to
 *     `sent`.
 *   - Field corrections merge into the existing record AND re-run
 *     through `validateInvite()`. Any correction that breaks
 *     validation rejects the entire patch — no half-application.
 *   - When a corrected `email` would land on an id already in the
 *     queue (and that id isn't this record's own id), reject with
 *     `code: "duplicate_email"`. The `id` itself is immutable —
 *     a corrected email does NOT rotate the record's KV key.
 *   - Empty patch → `code: "no_changes"`. Caller should 400.
 *   - `updatedAt` and `reviewedAt` are stamped on every accepted
 *     update; `reviewedBy` if supplied (trimmed, capped at 80 chars).
 */
export async function updateFaireInvite(
  id: string,
  patch: InviteUpdatePatch,
  options: { now?: Date } = {},
): Promise<
  { ok: true; invite: FaireInviteRecord } | { ok: false; error: InviteUpdateError }
> {
  const existing = await getInvite(id);
  if (!existing) {
    return {
      ok: false,
      error: {
        code: "not_found",
        message: `Invite ${id} not found in the queue.`,
      },
    };
  }

  const hasStatus = patch.status !== undefined;
  const hasNote = patch.reviewNote !== undefined;
  const hasCorrections =
    patch.fieldCorrections !== undefined &&
    typeof patch.fieldCorrections === "object" &&
    !Array.isArray(patch.fieldCorrections) &&
    Object.keys(patch.fieldCorrections).length > 0;

  if (!hasStatus && !hasNote && !hasCorrections) {
    return {
      ok: false,
      error: {
        code: "no_changes",
        message:
          "Patch must set at least one of status, reviewNote, or fieldCorrections.",
      },
    };
  }

  // ---- Status validation ----------------------------------------------
  if (hasStatus) {
    if (patch.status === "sent") {
      return {
        ok: false,
        error: {
          code: "sent_status_forbidden",
          message:
            "status='sent' cannot be set from the review route. The future Class B faire-direct.invite send closer is the only path that may flip an invite to 'sent'.",
        },
      };
    }
    if (
      !REVIEWABLE_STATUSES.includes(
        patch.status as Exclude<FaireInviteStatus, "sent">,
      )
    ) {
      return {
        ok: false,
        error: {
          code: "invalid_status",
          message: `status must be one of ${REVIEWABLE_STATUSES.join(", ")}`,
        },
      };
    }
  }

  // ---- Field corrections (merge + re-validate) -----------------------
  let mergedCandidate: FaireInviteCandidate = {
    retailerName: existing.retailerName,
    email: existing.email,
    source: existing.source,
    buyerName: existing.buyerName,
    city: existing.city,
    state: existing.state,
    notes: existing.notes,
    hubspotContactId: existing.hubspotContactId,
  };
  let corrected: Partial<FaireInviteCandidate> | null = null;
  if (hasCorrections) {
    const safe: Partial<FaireInviteCandidate> = {};
    const c = patch.fieldCorrections!;
    for (const key of Object.keys(c) as Array<keyof FaireInviteCandidate>) {
      if (!ALLOWED_CORRECTION_KEYS.has(key)) continue;
      const v = c[key];
      if (v === undefined) continue;
      // Allow empty string for clearable optional fields, but not for
      // required ones — `validateInvite` will catch that.
      (safe as Record<string, unknown>)[key] = v;
    }
    corrected = safe;
    const candidate: Partial<FaireInviteCandidate> = {
      ...mergedCandidate,
      ...safe,
    };
    const validation = validateInvite(candidate);
    if (!validation.ok) {
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message: `Corrected invite fails validation: ${validation.reason}`,
        },
      };
    }
    mergedCandidate = validation.candidate;
  }

  // ---- Duplicate-email guard ----------------------------------------
  // If the email changed, ensure no OTHER record in the queue uses it.
  if (mergedCandidate.email !== existing.email) {
    const newId = inviteIdFromEmail(mergedCandidate.email);
    if (newId !== existing.id) {
      const collision = await getInvite(newId);
      if (collision) {
        return {
          ok: false,
          error: {
            code: "duplicate_email",
            message: `An invite for ${mergedCandidate.email} is already in the queue (id=${newId}). Reject the duplicate or update the other record instead.`,
          },
        };
      }
    }
  }

  // ---- Apply lifecycle changes --------------------------------------
  const now = (options.now ?? new Date()).toISOString();
  const next: FaireInviteRecord = {
    // Start from the existing record (preserves id, queuedAt, etc.).
    ...existing,
    // Then overlay the validated candidate fields.
    retailerName: mergedCandidate.retailerName,
    email: mergedCandidate.email,
    source: mergedCandidate.source,
    buyerName: mergedCandidate.buyerName,
    city: mergedCandidate.city,
    state: mergedCandidate.state,
    notes: mergedCandidate.notes,
    hubspotContactId: mergedCandidate.hubspotContactId,
  };
  if (hasStatus) next.status = patch.status as FaireInviteStatus;
  if (hasNote) {
    const note = (patch.reviewNote ?? "").trim();
    if (note.length === 0) {
      delete next.reviewNote;
    } else {
      next.reviewNote = note.slice(0, 1000);
    }
  }
  next.updatedAt = now;
  next.reviewedAt = now;
  if (typeof patch.reviewedBy === "string" && patch.reviewedBy.trim().length > 0) {
    next.reviewedBy = patch.reviewedBy.trim().slice(0, 80);
  }

  // ---- Persist (id is immutable; we never rotate the KV key) -------
  await kv.set(inviteKey(existing.id), JSON.stringify(next));
  // `corrected` referenced solely as a structural marker — kept lint-clean.
  void corrected;
  return { ok: true, invite: next };
}

/** Test helper — clear all invite KV keys + the index. */
export async function __resetInvitesForTest(): Promise<void> {
  try {
    const ids = await readIndex();
    for (const id of ids) {
      await kv.set(inviteKey(id), null);
    }
    await kv.set(KV_INDEX, []);
  } catch {
    /* fail-soft */
  }
}
