/**
 * Vendor COI upload — Phase 31.2.c.
 *
 * The COI (Certificate of Insurance) upload helper for the public
 * vendor portal. Each vendor entry in the registry has a
 * `coiDriveFolderId` — this helper writes the uploaded file into
 * THAT folder, using the same Drive OAuth credentials as the rest
 * of the durable-upload pipeline.
 *
 * Hard rules:
 *   - **Validates MIME against the same allow-list as
 *     `drive-upload.ts`** (`ALLOWED_UPLOAD_MIME_TYPES`). PDFs,
 *     images, Word docs.
 *   - **Validates size against `MAX_UPLOAD_BYTES`** (10MB).
 *   - **Empty bytes refused** — anti-fabrication for zero-byte
 *     "uploads" that pass MIME but have no content.
 *   - **Refuses without a parentFolderId** — never writes a
 *     vendor's COI into the wrong folder via fallback to
 *     `GOOGLE_DRIVE_UPLOAD_PARENT_ID`.
 *   - **Drive write failure → typed error**, never throws. The
 *     route surfaces a 5xx.
 *   - **Filename canonicalized** to
 *     `COI_<vendorIdSlug>_<YYYY-MM-DD>.<ext>`. Original filename
 *     is preserved in the Drive `description` for traceability.
 *
 * Pure-ish: depends on Drive API; tested via a googleapis mock.
 */
import { Readable } from "stream";

import {
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_BYTES,
} from "./drive-upload";

export interface VendorCoiUploadInput {
  /** Registry vendorId (kebab-case). Used for the canonical filename. */
  vendorId: string;
  /** Vendor display name; used in the Drive description for traceability. */
  displayName: string;
  /** Original filename from the multipart upload. Preserved in description. */
  fileName: string;
  /** Raw bytes. */
  data: Buffer;
  mimeType: string;
  /** Vendor's COI Drive folder. From VENDOR_PORTAL_REGISTRY entry. */
  parentFolderId: string;
}

export type VendorCoiUploadResult =
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
      code:
        | "drive_oauth_missing"
        | "drive_upload_failed"
        | "validation_failed";
      error: string;
    };

function extensionFor(mimeType: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot >= 0 && dot < fileName.length - 1) {
    const ext = fileName.slice(dot).toLowerCase();
    if (/^\.[a-z0-9]{1,5}$/i.test(ext)) return ext;
  }
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return ".jpg";
  if (mimeType === "image/heic") return ".heic";
  if (mimeType === "image/heif") return ".heif";
  if (mimeType === "application/msword") return ".doc";
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return ".docx";
  return "";
}

function safeName(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Read Drive OAuth env (same precedence as `drive-upload.ts`).
 * Pure data extraction; returns null when any required var is missing.
 */
function readDriveOAuthEnv(): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
} | null {
  const clientId =
    process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GCP_GMAIL_OAUTH_CLIENT_ID;
  const clientSecret =
    process.env.GMAIL_OAUTH_CLIENT_SECRET ||
    process.env.GCP_GMAIL_OAUTH_CLIENT_SECRET;
  const refreshToken =
    process.env.GMAIL_OAUTH_REFRESH_TOKEN ||
    process.env.GCP_GMAIL_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

export async function uploadVendorCoi(
  input: VendorCoiUploadInput,
): Promise<VendorCoiUploadResult> {
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
  if (!input.parentFolderId) {
    return {
      ok: false,
      code: "validation_failed",
      error:
        "parentFolderId is required — vendor's coiDriveFolderId is unset in the registry",
    };
  }
  if (!input.vendorId) {
    return {
      ok: false,
      code: "validation_failed",
      error: "vendorId is required",
    };
  }

  const oauth = readDriveOAuthEnv();
  if (!oauth) {
    return {
      ok: false,
      code: "drive_oauth_missing",
      error:
        "GMAIL_OAUTH_CLIENT_ID / SECRET / REFRESH_TOKEN missing. Drive scope required for COI uploads.",
    };
  }

  // Lazy import keeps googleapis out of cold-start for callers
  // that don't reach the Drive write path.
  const { google } = await import("googleapis");
  const oauth2 = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret);
  oauth2.setCredentials({ refresh_token: oauth.refreshToken });
  const drive = google.drive({ version: "v3", auth: oauth2 });

  const dateStr = new Date().toISOString().slice(0, 10);
  const slug = safeName(input.vendorId) || "vendor";
  const ext = extensionFor(input.mimeType, input.fileName);
  const driveName = `COI_${slug}_${dateStr}${ext}`;

  try {
    const created = await drive.files.create({
      requestBody: {
        name: driveName,
        parents: [input.parentFolderId],
        description: `Vendor COI upload — ${input.displayName} — original filename: ${input.fileName.slice(0, 200)}`,
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
      parentFolderId: input.parentFolderId,
    };
  } catch (err) {
    return {
      ok: false,
      code: "drive_upload_failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
