/**
 * Shipping artifact persistence — durable label + packing-slip storage.
 *
 * The auto-ship pipeline buys a label in ShipStation and historically
 * dropped only the label PDF into Slack `#operations`. If Slack file
 * upload silently failed (token scope, channel rename, transient API
 * error) the label was effectively lost: there was no other place a
 * non-engineer could go to print it.
 *
 * This module makes both artifacts durable:
 *
 *   1. Label PDF (page 1 of ShipStation's 2-page download) → Drive
 *   2. Packing slip PDF (page 2) → Drive
 *   3. Per-order metadata (Drive ids + Slack permalink) → KV
 *
 * The returned shape is "artifact links + flags." It is intentionally
 * fail-soft: Drive misconfiguration or upload errors return null fields
 * but never throw and never block the label buy. The label buy is
 * authoritative; this module is observability + recoverability.
 *
 * Folder layout under <parent>:
 *   labels/<source>/<orderNumber>-label-<timestamp>.pdf
 *   labels/<source>/<orderNumber>-packing-slip-<timestamp>.pdf
 *
 * Where <source> ∈ {amazon, shopify, faire, manual} from the auto-ship
 * sourceLabelFor(order) helper. The timestamp suffix is defensive — if
 * a label is voided + repurchased we don't overwrite the original.
 *
 * Required env (any one parent set + the GMAIL_OAUTH_* trio):
 *   GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID  <- preferred (dedicated parent)
 *   GOOGLE_DRIVE_UPLOAD_PARENT_ID              <- fallback (shared upload root)
 *   GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID   <- last-resort fallback
 */

import { kv } from "@vercel/kv";
import type { drive_v3 } from "googleapis";
import { Readable } from "node:stream";

export interface ShippingArtifactInput {
  /** ShipStation order number (e.g. "112-6147345-5547445" or "#1052"). */
  orderNumber: string;
  /** Source label (amazon | shopify | faire | manual | etc). */
  source: string;
  /** Tracking number for the just-purchased label. */
  trackingNumber?: string | null;
  /** Raw bytes of the FULL ShipStation download (label + packing slip). */
  fullPdf: Buffer;
  /** Pre-computed label-only PDF (page 1). Optional — module will compute if absent. */
  labelOnlyPdf?: Buffer;
  /** Pre-computed packing-slip-only PDF (page 2). Optional. */
  packingSlipOnlyPdf?: Buffer;
}

export interface ArtifactRef {
  fileId: string;
  webViewLink: string | null;
}

export interface ShippingArtifactRecord {
  orderNumber: string;
  source: string;
  trackingNumber: string | null;
  /** Drive ref for the LABEL-ONLY page (page 1). null if Drive unavailable / upload failed. */
  label: ArtifactRef | null;
  /** Drive ref for the packing-slip page (page 2). null if not present or Drive unavailable. */
  packingSlip: ArtifactRef | null;
  /** Slack permalink to the label upload, when set later. */
  slackPermalink: string | null;
  persistedAt: string;
  /** When Drive isn't configured / failed, why. Surfaced for observability. */
  driveError: string | null;
  /**
   * ISO timestamp when the package physically left the warehouse.
   * Set by the Slack `:white_check_mark:` reaction handler. null until
   * the operator marks it shipped. Re-marking is idempotent (overwrites
   * with the latest stamp); un-reacting clears it.
   */
  dispatchedAt?: string | null;
  /** Slack user ID who reacted to mark dispatched. null when unset. */
  dispatchedBy?: string | null;
}

const KV_PREFIX = "shipping:artifacts:";
const KV_TTL_SECONDS = 60 * 24 * 3600; // 60 days — longer than auto-shipped dedup window

function kvKey(source: string, orderNumber: string): string {
  return `${KV_PREFIX}${source}:${orderNumber}`;
}

function resolveParentId(): string | null {
  return (
    process.env.GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID ||
    process.env.GOOGLE_DRIVE_UPLOAD_PARENT_ID ||
    process.env.GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID ||
    process.env.DRIVE_VENDOR_ONBOARDING_PARENT_ID ||
    null
  );
}

function hasOauthEnv(): boolean {
  const id =
    process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GCP_GMAIL_OAUTH_CLIENT_ID;
  const secret =
    process.env.GMAIL_OAUTH_CLIENT_SECRET ||
    process.env.GCP_GMAIL_OAUTH_CLIENT_SECRET;
  const token =
    process.env.GMAIL_OAUTH_REFRESH_TOKEN ||
    process.env.GCP_GMAIL_OAUTH_REFRESH_TOKEN;
  return Boolean(id && secret && token);
}

export function isShippingArtifactsConfigured(): boolean {
  return resolveParentId() !== null && hasOauthEnv();
}

async function getDriveClient(): Promise<drive_v3.Drive | null> {
  if (!hasOauthEnv()) return null;
  const id =
    process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GCP_GMAIL_OAUTH_CLIENT_ID;
  const secret =
    process.env.GMAIL_OAUTH_CLIENT_SECRET ||
    process.env.GCP_GMAIL_OAUTH_CLIENT_SECRET;
  const token =
    process.env.GMAIL_OAUTH_REFRESH_TOKEN ||
    process.env.GCP_GMAIL_OAUTH_REFRESH_TOKEN;
  const { google } = await import("googleapis");
  const oauth = new google.auth.OAuth2(id!, secret!);
  oauth.setCredentials({ refresh_token: token! });
  return google.drive({ version: "v3", auth: oauth });
}

// In-process folder cache so we don't list+create per artifact.
const folderCache = new Map<string, string>();

async function ensureFolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string,
): Promise<string> {
  const cacheKey = `${parentId}:${name}`;
  const cached = folderCache.get(cacheKey);
  if (cached) return cached;
  // Sanitize the name for the Drive query — single quotes need escaping.
  const safeName = name.replace(/'/g, "\\'");
  const q = [
    `'${parentId}' in parents`,
    `name = '${safeName}'`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    `trashed = false`,
  ].join(" and ");
  const list = await drive.files.list({
    q,
    fields: "files(id,name)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const found = list.data.files?.[0]?.id;
  if (found) {
    folderCache.set(cacheKey, found);
    return found;
  }
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
      description: `USA Gummies shipping artifacts — ${name}`,
    },
    fields: "id",
    supportsAllDrives: true,
  });
  const id = created.data.id!;
  folderCache.set(cacheKey, id);
  return id;
}

async function uploadPdf(
  drive: drive_v3.Drive,
  parentId: string,
  filename: string,
  bytes: Buffer,
): Promise<ArtifactRef> {
  const created = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [parentId],
      mimeType: "application/pdf",
    },
    media: {
      mimeType: "application/pdf",
      body: Readable.from(bytes),
    },
    fields: "id,webViewLink",
    supportsAllDrives: true,
  });
  return {
    fileId: created.data.id!,
    webViewLink: created.data.webViewLink ?? null,
  };
}

/**
 * Split the ShipStation 2-page PDF into label (page 1) and packing slip
 * (page 2). Pure helper — exported so the route can compute once and
 * pass both into `persistLabelArtifacts` without re-parsing.
 *
 * Returns `{ labelOnly, packingSlipOnly }`. Either may be null if the
 * PDF has fewer pages or pdf-lib fails to parse.
 */
export async function splitLabelAndPackingSlip(
  pdfBytes: Buffer,
): Promise<{ labelOnly: Buffer | null; packingSlipOnly: Buffer | null }> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const src = await PDFDocument.load(pdfBytes);
    const pageCount = src.getPageCount();
    if (pageCount === 0) return { labelOnly: null, packingSlipOnly: null };

    let labelOnly: Buffer | null = null;
    if (pageCount >= 1) {
      const labelDoc = await PDFDocument.create();
      const [p1] = await labelDoc.copyPages(src, [0]);
      labelDoc.addPage(p1);
      labelOnly = Buffer.from(await labelDoc.save());
    }

    let packingSlipOnly: Buffer | null = null;
    if (pageCount >= 2) {
      const slipDoc = await PDFDocument.create();
      const [p2] = await slipDoc.copyPages(src, [1]);
      slipDoc.addPage(p2);
      packingSlipOnly = Buffer.from(await slipDoc.save());
    }
    return { labelOnly, packingSlipOnly };
  } catch {
    return { labelOnly: null, packingSlipOnly: null };
  }
}

/**
 * Persist the label + packing slip to Drive and write a metadata row to
 * KV. Always returns a record — never throws. When Drive isn't
 * configured the record's `label` and `packingSlip` are null and
 * `driveError` carries the reason.
 *
 * The Slack permalink is set later via `attachSlackPermalink()` once the
 * Slack upload completes; this keeps the two side-effects independent
 * (Drive upload happens before Slack upload, and a Slack failure can't
 * undo the Drive write).
 */
export async function persistLabelArtifacts(
  input: ShippingArtifactInput,
): Promise<ShippingArtifactRecord> {
  const persistedAt = new Date().toISOString();
  const safeOrder = input.orderNumber.replace(/[^a-zA-Z0-9_-]/g, "_");
  const suffix = persistedAt
    .slice(0, 19)
    .replace(/[^0-9]/g, "")
    .slice(0, 14); // YYYYMMDDHHMMSS

  const parentId = resolveParentId();
  const drive = await getDriveClient();

  let label: ArtifactRef | null = null;
  let packingSlip: ArtifactRef | null = null;
  let driveError: string | null = null;

  if (!parentId) {
    driveError =
      "GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID (or GOOGLE_DRIVE_UPLOAD_PARENT_ID fallback) is not set";
  } else if (!drive) {
    driveError =
      "GMAIL_OAUTH_CLIENT_ID / SECRET / REFRESH_TOKEN missing — cannot upload to Drive";
  } else {
    // Compute split on demand if the route didn't pre-split.
    const split =
      input.labelOnlyPdf || input.packingSlipOnlyPdf
        ? {
            labelOnly: input.labelOnlyPdf ?? null,
            packingSlipOnly: input.packingSlipOnlyPdf ?? null,
          }
        : await splitLabelAndPackingSlip(input.fullPdf);

    try {
      const labelsParent = await ensureFolder(drive, parentId, "labels");
      const sourceParent = await ensureFolder(
        drive,
        labelsParent,
        input.source || "manual",
      );
      if (split.labelOnly) {
        try {
          label = await uploadPdf(
            drive,
            sourceParent,
            `${safeOrder}-label-${suffix}.pdf`,
            split.labelOnly,
          );
        } catch (err) {
          driveError = `label upload: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      if (split.packingSlipOnly) {
        try {
          packingSlip = await uploadPdf(
            drive,
            sourceParent,
            `${safeOrder}-packing-slip-${suffix}.pdf`,
            split.packingSlipOnly,
          );
        } catch (err) {
          // Don't overwrite a label upload error — concat instead.
          const msg = `packing-slip upload: ${err instanceof Error ? err.message : String(err)}`;
          driveError = driveError ? `${driveError} | ${msg}` : msg;
        }
      }
    } catch (err) {
      driveError = `folder ensure: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const record: ShippingArtifactRecord = {
    orderNumber: input.orderNumber,
    source: input.source,
    trackingNumber: input.trackingNumber ?? null,
    label,
    packingSlip,
    slackPermalink: null,
    persistedAt,
    driveError,
  };

  // KV write is also fail-soft. If KV is degraded we still return the
  // record; recent-labels just won't be able to join up later.
  try {
    await kv.set(kvKey(input.source, input.orderNumber), JSON.stringify(record), {
      ex: KV_TTL_SECONDS,
    });
  } catch {
    /* non-fatal */
  }

  return record;
}

/**
 * Attach (or replace) the Slack permalink on a previously-persisted
 * artifact record. Called after Slack file upload returns. Idempotent —
 * a missing record means we just write a fresh one with what we know,
 * so recent-labels still has a row to surface.
 */
export async function attachSlackPermalink(opts: {
  source: string;
  orderNumber: string;
  slackPermalink: string | null;
}): Promise<void> {
  try {
    const key = kvKey(opts.source, opts.orderNumber);
    const existing = await kv.get<string | ShippingArtifactRecord>(key);
    let record: ShippingArtifactRecord;
    if (existing && typeof existing === "object" && "orderNumber" in existing) {
      record = existing as ShippingArtifactRecord;
    } else if (typeof existing === "string") {
      try {
        record = JSON.parse(existing) as ShippingArtifactRecord;
      } catch {
        record = bareRecord(opts.source, opts.orderNumber);
      }
    } else {
      record = bareRecord(opts.source, opts.orderNumber);
    }
    record.slackPermalink = opts.slackPermalink;
    await kv.set(key, JSON.stringify(record), { ex: KV_TTL_SECONDS });
  } catch {
    /* non-fatal */
  }
}

/**
 * Stamp `dispatchedAt` + `dispatchedBy` on the artifact record.
 *
 * Wired to the Slack `:white_check_mark:` reaction listener in
 * `/api/ops/slack/events` — when an operator reacts to a label post in
 * `#shipping`, the listener resolves the (source, orderNumber) tuple
 * from the artifact registry and calls this. Idempotent: re-marking
 * overwrites with the new stamp instead of erroring.
 *
 * Returns `{ ok, before, after }` so callers can detect first-time
 * marks vs. re-marks (e.g. to avoid double-posting "Dispatched" thread
 * replies on duplicate reaction events).
 */
export async function markDispatched(opts: {
  source: string;
  orderNumber: string;
  dispatchedBy: string | null;
  /** Override timestamp — defaults to `new Date().toISOString()`. */
  dispatchedAt?: string;
}): Promise<{
  ok: boolean;
  before: string | null;
  after: string;
  record: ShippingArtifactRecord | null;
}> {
  const dispatchedAt = opts.dispatchedAt ?? new Date().toISOString();
  try {
    const key = kvKey(opts.source, opts.orderNumber);
    const existing = await kv.get<string | ShippingArtifactRecord>(key);
    let record: ShippingArtifactRecord;
    if (existing && typeof existing === "object" && "orderNumber" in existing) {
      record = existing as ShippingArtifactRecord;
    } else if (typeof existing === "string") {
      try {
        record = JSON.parse(existing) as ShippingArtifactRecord;
      } catch {
        record = bareRecord(opts.source, opts.orderNumber);
      }
    } else {
      record = bareRecord(opts.source, opts.orderNumber);
    }
    const before = record.dispatchedAt ?? null;
    record.dispatchedAt = dispatchedAt;
    record.dispatchedBy = opts.dispatchedBy;
    await kv.set(key, JSON.stringify(record), { ex: KV_TTL_SECONDS });
    return { ok: true, before, after: dispatchedAt, record };
  } catch {
    return { ok: false, before: null, after: dispatchedAt, record: null };
  }
}

/**
 * Clear `dispatchedAt` (un-mark dispatched). Wired to the Slack
 * `reaction_removed` event so removing the `:white_check_mark:` reaction
 * reverts the dispatch state.
 */
export async function clearDispatched(opts: {
  source: string;
  orderNumber: string;
}): Promise<{ ok: boolean; before: string | null }> {
  try {
    const key = kvKey(opts.source, opts.orderNumber);
    const existing = await kv.get<string | ShippingArtifactRecord>(key);
    if (!existing) return { ok: true, before: null };
    let record: ShippingArtifactRecord;
    if (typeof existing === "object" && "orderNumber" in existing) {
      record = existing as ShippingArtifactRecord;
    } else if (typeof existing === "string") {
      try {
        record = JSON.parse(existing) as ShippingArtifactRecord;
      } catch {
        return { ok: true, before: null };
      }
    } else {
      return { ok: true, before: null };
    }
    const before = record.dispatchedAt ?? null;
    record.dispatchedAt = null;
    record.dispatchedBy = null;
    await kv.set(key, JSON.stringify(record), { ex: KV_TTL_SECONDS });
    return { ok: true, before };
  } catch {
    return { ok: false, before: null };
  }
}

/**
 * Look up an artifact record by Slack permalink. Used by the
 * reaction-handler path: Slack tells us a (channel, ts) pair, we need
 * to map that back to the (source, orderNumber) we persisted via
 * `attachSlackPermalink`.
 *
 * Slack permalinks embed the message ts in the path segment after `/p`
 * — e.g. `…/archives/C0AS4635HFG/p1745000000123456` corresponds to
 * `1745000000.123456`. We accept either the full permalink OR the
 * `(channel, ts)` tuple. Naive scan: 60-day TTL caps the working set
 * to ~2-3k records, which fits comfortably in a single `kv.scan`.
 *
 * Returns null if no match — callers treat that as "not one of ours,
 * ignore the reaction".
 */
export async function findArtifactBySlackTs(opts: {
  channelId: string;
  messageTs: string;
}): Promise<ShippingArtifactRecord | null> {
  // The permalink format Slack returns from files.completeUploadExternal:
  //   https://<workspace>.slack.com/archives/<channelId>/p<digits>
  // where <digits> is messageTs with the decimal removed. We compare
  // against the stored permalink rather than ts directly — a stored
  // record with no permalink can't have been the source of a reaction
  // on a Slack message anyway.
  const tsCompact = opts.messageTs.replace(".", "");
  // Best-effort: pull all artifact keys via scan.
  try {
    let cursor: string | number = 0;
    const matchKey = `${KV_PREFIX}*`;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const scanResult = (await kv.scan(cursor, {
        match: matchKey,
        count: 200,
      })) as unknown as [string | number, string[]];
      const [next, keys] = scanResult;
      for (const key of keys) {
        const v = await kv.get<string | ShippingArtifactRecord>(key);
        if (!v) continue;
        let rec: ShippingArtifactRecord;
        if (typeof v === "object" && "orderNumber" in v) {
          rec = v as ShippingArtifactRecord;
        } else if (typeof v === "string") {
          try {
            rec = JSON.parse(v) as ShippingArtifactRecord;
          } catch {
            continue;
          }
        } else {
          continue;
        }
        if (!rec.slackPermalink) continue;
        if (
          rec.slackPermalink.includes(`/${opts.channelId}/p${tsCompact}`) ||
          rec.slackPermalink.includes(`/${opts.channelId}/p${tsCompact.split("?")[0]}`)
        ) {
          return rec;
        }
      }
      if (Number(next) === 0 || next === "0") break;
      cursor = next;
    }
  } catch {
    /* fall through */
  }
  return null;
}

function bareRecord(source: string, orderNumber: string): ShippingArtifactRecord {
  return {
    orderNumber,
    source,
    trackingNumber: null,
    label: null,
    packingSlip: null,
    slackPermalink: null,
    persistedAt: new Date().toISOString(),
    driveError: "no Drive write — record created bare for Slack permalink only",
  };
}

/**
 * Fetch artifact metadata for a single order. Returns null when nothing
 * was persisted (KV miss / TTL expiry / artifact module never ran).
 */
export async function getShippingArtifact(
  source: string,
  orderNumber: string,
): Promise<ShippingArtifactRecord | null> {
  try {
    const v = await kv.get<string | ShippingArtifactRecord>(
      kvKey(source, orderNumber),
    );
    if (!v) return null;
    if (typeof v === "string") {
      try {
        return JSON.parse(v) as ShippingArtifactRecord;
      } catch {
        return null;
      }
    }
    return v as ShippingArtifactRecord;
  } catch {
    return null;
  }
}

/**
 * Bulk-lookup artifacts for a list of (source, orderNumber) pairs.
 * Used by /api/ops/fulfillment/recent-labels to enrich the table.
 *
 * When a recent-labels caller doesn't know the source up-front, pass an
 * array of bare order numbers — the function tries every known source
 * prefix and returns the first hit. ShipStation order numbers from
 * Amazon (XXX-XXXXXXX-XXXXXXX) and Shopify (numeric / #-prefixed) don't
 * collide, so this is safe.
 */
export async function bulkLookupArtifacts(
  pairs: Array<{ source?: string | null; orderNumber: string }>,
): Promise<Map<string, ShippingArtifactRecord>> {
  const out = new Map<string, ShippingArtifactRecord>();
  const sources = ["amazon", "shopify", "faire", "manual"];
  for (const p of pairs) {
    if (!p.orderNumber) continue;
    if (p.source) {
      const r = await getShippingArtifact(p.source, p.orderNumber);
      if (r) out.set(p.orderNumber, r);
      continue;
    }
    for (const s of sources) {
      const r = await getShippingArtifact(s, p.orderNumber);
      if (r) {
        out.set(p.orderNumber, r);
        break;
      }
    }
  }
  return out;
}

/** Test helper: drop the in-process folder cache between specs. */
export function __resetShippingArtifactsCacheForTest(): void {
  folderCache.clear();
}
