/**
 * Durable Drive uploads for public-facing forms (NCS-001) and internal
 * vendor-doc capture (W-9, COI, custom vendor forms).
 *
 * Why this module exists
 * ----------------------
 * `/api/ops/upload` previously wrote files to the local filesystem under
 * `<cwd>/uploads/`. On Vercel that path is ephemeral — the directory
 * disappears on every redeploy and a new function instance starts with
 * an empty disk. Customer-uploaded NCS-001 forms were silently lost.
 *
 * This module replaces that with a Google Drive write through the same
 * OAuth refresh token used by `gmail-reader` and `drive-reader`. We
 * fail-closed when the env / scope is missing — never silently fall
 * back to local FS, since "lost upload" is worse than "explicit 503".
 *
 * Folder layout (under the configured parent):
 *
 *   <parent>/
 *     ncs/           <- NCS-001 customer setup forms
 *     w9/            <- vendor W-9s (free-form, not the main onboarding)
 *     coi/           <- vendor certificates of insurance
 *     receipt/       <- receipts / invoices awaiting finance review
 *     vendor-form/   <- arbitrary vendor-supplied paperwork
 *     other/         <- catch-all (always writeable, never blocking)
 *
 * Folders are created on demand and cached for the process lifetime.
 *
 * Auth: shares OAuth client credentials with gmail-reader / drive-reader.
 * Required scope: `https://www.googleapis.com/auth/drive`. `drive.readonly`
 * cannot write, and `drive.file` is not dependable for a pre-existing
 * parent folder id unless the app created/opened that parent first. The
 * consent flow at /api/ops/fulfillment/oauth-consent-url requests the full
 * Drive scope so uploads can target the configured company folder.
 *
 * Required env (any one set + the GMAIL_OAUTH_* trio):
 *   GOOGLE_DRIVE_UPLOAD_PARENT_ID         <- preferred for public uploads
 *   GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID  <- fallback (vendor docs)
 *   DRIVE_VENDOR_ONBOARDING_PARENT_ID     <- legacy fallback
 */

import type { drive_v3 } from "googleapis";
import { Readable } from "node:stream";

export type DocType =
  | "ncs"
  | "w9"
  | "coi"
  | "receipt"
  | "vendor-form"
  | "other";

export const DOC_TYPES: readonly DocType[] = [
  "ncs",
  "w9",
  "coi",
  "receipt",
  "vendor-form",
  "other",
] as const;

/** Allow-list of MIME types we accept for upload. */
export const ALLOWED_UPLOAD_MIME_TYPES: readonly string[] = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/heic",
  "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

/** Max file size accepted, in bytes. 10 MB. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface DurableUploadInput {
  /** Original filename from the multipart upload. Used for display + safe name. */
  fileName: string;
  /** Raw bytes of the file. */
  data: Buffer;
  mimeType: string;
  /** Doc category — drives which subfolder the file lands in. */
  docType: DocType;
  /** Free-form display string for the submitter (customer / vendor). Sanitized before use. */
  submitter: string;
  /** Optional notes for the audit + Slack notification. Not stored on Drive. */
  notes?: string;
}

export type DurableUploadResult =
  | {
      ok: true;
      fileId: string;
      name: string;
      mimeType: string;
      size: number;
      webViewLink: string | null;
      parentFolderId: string;
    }
  | {
      ok: false;
      /** Stable machine-readable code for the caller to switch on. */
      code:
        | "drive_not_configured"
        | "drive_oauth_missing"
        | "drive_create_failed"
        | "drive_upload_failed"
        | "validation_failed";
      error: string;
    };

interface DriveClientResult {
  ok: true;
  drive: drive_v3.Drive;
  parentId: string;
}

interface DriveClientError {
  ok: false;
  code: "drive_not_configured" | "drive_oauth_missing";
  error: string;
}

/**
 * Determine whether this runtime is configured for durable uploads.
 * Cheap to call from a route's first-line guard.
 */
export function isDurableUploadConfigured(): boolean {
  return resolveParentId() !== null && hasOauthEnv();
}

function resolveParentId(): string | null {
  return (
    process.env.GOOGLE_DRIVE_UPLOAD_PARENT_ID ||
    process.env.GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID ||
    process.env.DRIVE_VENDOR_ONBOARDING_PARENT_ID ||
    null
  );
}

function hasOauthEnv(): boolean {
  const clientId =
    process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GCP_GMAIL_OAUTH_CLIENT_ID;
  const clientSecret =
    process.env.GMAIL_OAUTH_CLIENT_SECRET ||
    process.env.GCP_GMAIL_OAUTH_CLIENT_SECRET;
  const refreshToken =
    process.env.GMAIL_OAUTH_REFRESH_TOKEN ||
    process.env.GCP_GMAIL_OAUTH_REFRESH_TOKEN;
  return Boolean(clientId && clientSecret && refreshToken);
}

async function getDriveClient(): Promise<DriveClientResult | DriveClientError> {
  const parentId = resolveParentId();
  if (!parentId) {
    return {
      ok: false,
      code: "drive_not_configured",
      error:
        "GOOGLE_DRIVE_UPLOAD_PARENT_ID is not set. Configure the Drive parent folder before enabling the upload route.",
    };
  }
  const clientId =
    process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GCP_GMAIL_OAUTH_CLIENT_ID;
  const clientSecret =
    process.env.GMAIL_OAUTH_CLIENT_SECRET ||
    process.env.GCP_GMAIL_OAUTH_CLIENT_SECRET;
  const refreshToken =
    process.env.GMAIL_OAUTH_REFRESH_TOKEN ||
    process.env.GCP_GMAIL_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    return {
      ok: false,
      code: "drive_oauth_missing",
      error:
        "GMAIL_OAUTH_CLIENT_ID / SECRET / REFRESH_TOKEN missing. Run /api/ops/fulfillment/oauth-consent-url to mint a refresh token with Drive scope.",
    };
  }
  // Lazy import keeps `googleapis` out of the cold-start path of routes
  // that don't actually need it.
  const { google } = await import("googleapis");
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const drive = google.drive({ version: "v3", auth: oauth2 });
  return { ok: true, drive, parentId };
}

// Folder cache so we don't re-create per upload. Keyed by `${parentId}:${docType}`.
const folderCache = new Map<string, string>();

async function ensureSubfolder(
  drive: drive_v3.Drive,
  parentId: string,
  docType: DocType,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const cacheKey = `${parentId}:${docType}`;
  const cached = folderCache.get(cacheKey);
  if (cached) return { ok: true, id: cached };

  try {
    // Look for an existing folder by name first — keeps the Drive tidy
    // even if the cache was cleared (cold start, redeploy).
    const q = [
      `'${parentId}' in parents`,
      `name = '${docType}'`,
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
      return { ok: true, id: found };
    }
    const created = await drive.files.create({
      requestBody: {
        name: docType,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
        description: `USA Gummies durable upload — ${docType}`,
      },
      fields: "id,name",
      supportsAllDrives: true,
    });
    const id = created.data.id;
    if (!id) {
      return { ok: false, error: "Drive folder created without id" };
    }
    folderCache.set(cacheKey, id);
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_").slice(0, 80);
}

function extensionFor(mime: string, originalName: string): string {
  if (originalName.includes(".")) return originalName.slice(originalName.lastIndexOf("."));
  switch (mime) {
    case "application/pdf":
      return ".pdf";
    case "image/png":
      return ".png";
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/heic":
    case "image/heif":
      return ".heic";
    case "application/msword":
      return ".doc";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return ".docx";
    default:
      return "";
  }
}

/**
 * Write a single file to durable storage. Fail-closed: if Drive isn't
 * configured or the upload fails, return a structured error — never
 * write to local disk. Caller decides whether to surface a 5xx or a
 * user-facing message.
 */
export async function uploadDurableFile(
  input: DurableUploadInput,
): Promise<DurableUploadResult> {
  // Defensive validation. The route handler runs the same checks before
  // calling us, but we re-check here so a future caller can't bypass.
  if (!input.data || input.data.byteLength === 0) {
    return { ok: false, code: "validation_failed", error: "Empty file" };
  }
  if (input.data.byteLength > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      code: "validation_failed",
      error: `File exceeds ${MAX_UPLOAD_BYTES} bytes`,
    };
  }
  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(input.mimeType)) {
    return {
      ok: false,
      code: "validation_failed",
      error: `MIME type not allowed: ${input.mimeType}`,
    };
  }
  if (!DOC_TYPES.includes(input.docType)) {
    return {
      ok: false,
      code: "validation_failed",
      error: `docType not allowed: ${input.docType}`,
    };
  }

  const client = await getDriveClient();
  if (!client.ok) {
    return { ok: false, code: client.code, error: client.error };
  }

  const subfolder = await ensureSubfolder(
    client.drive,
    client.parentId,
    input.docType,
  );
  if (!subfolder.ok) {
    return { ok: false, code: "drive_create_failed", error: subfolder.error };
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const submitterSlug = safeName(input.submitter || "unknown") || "unknown";
  const ext = extensionFor(input.mimeType, input.fileName);
  const driveName = `${input.docType.toUpperCase()}_${submitterSlug}_${dateStr}${ext}`;

  try {
    const created = await client.drive.files.create({
      requestBody: {
        name: driveName,
        parents: [subfolder.id],
        description: input.notes ? input.notes.slice(0, 1000) : undefined,
        mimeType: input.mimeType,
      },
      media: {
        mimeType: input.mimeType,
        body: Readable.from(input.data),
      },
      fields: "id,name,mimeType,size,webViewLink",
      supportsAllDrives: true,
    });
    const id = created.data.id;
    if (!id) {
      return {
        ok: false,
        code: "drive_upload_failed",
        error: "Drive upload returned no file id",
      };
    }
    return {
      ok: true,
      fileId: id,
      name: created.data.name ?? driveName,
      mimeType: created.data.mimeType ?? input.mimeType,
      size: Number(created.data.size ?? input.data.byteLength),
      webViewLink: created.data.webViewLink ?? null,
      parentFolderId: subfolder.id,
    };
  } catch (err) {
    return {
      ok: false,
      code: "drive_upload_failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Test helper: drop the in-process folder cache between specs. */
export function __resetDurableUploadCacheForTest(): void {
  folderCache.clear();
}
