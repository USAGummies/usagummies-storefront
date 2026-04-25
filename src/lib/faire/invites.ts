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
