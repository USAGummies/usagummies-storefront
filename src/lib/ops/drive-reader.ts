/**
 * Google Drive file reader — shares OAuth credentials with gmail-reader.ts.
 *
 * Use cases:
 *   - AP-packet send flow: fetch W-9, CIF-001, sell sheet PDFs by Drive
 *     file id so they can be attached to a Gmail send.
 *   - Vendor onboarding: pull uploaded W-9 / COI from Drive for audit.
 *
 * Auth: requires the OAuth refresh token to include either
 *   https://www.googleapis.com/auth/drive.readonly (read + download), or
 *   https://www.googleapis.com/auth/drive (full access, broader).
 *
 * If the refresh token was minted without Drive scope, all calls here
 * 403 with `insufficient_scope`. Caller should surface that as a
 * configuration blocker and point Ben at the OAuth consent flow to
 * re-grant with Drive scope.
 */
import { google } from "googleapis";

export type DriveFileRef =
  | { kind: "file"; fileId: string }
  | { kind: "spreadsheet"; fileId: string }
  | { kind: "document"; fileId: string }
  | { kind: "unknown"; raw: string };

export type DriveFileContent = {
  fileId: string;
  name: string;
  mimeType: string;
  data: Buffer;
  size: number;
};

let _drive: ReturnType<typeof google.drive> | null = null;

function getDriveClient(): ReturnType<typeof google.drive> | null {
  if (_drive) return _drive;
  const clientId =
    process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GCP_GMAIL_OAUTH_CLIENT_ID;
  const clientSecret =
    process.env.GMAIL_OAUTH_CLIENT_SECRET ||
    process.env.GCP_GMAIL_OAUTH_CLIENT_SECRET;
  const refreshToken =
    process.env.GMAIL_OAUTH_REFRESH_TOKEN ||
    process.env.GCP_GMAIL_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  _drive = google.drive({ version: "v3", auth: oauth2 });
  return _drive;
}

/**
 * Parse a variety of Drive URL shapes into a typed file reference:
 *   https://drive.google.com/file/d/<id>/view?usp=...
 *   https://drive.google.com/open?id=<id>
 *   https://docs.google.com/spreadsheets/d/<id>/edit?usp=...
 *   https://docs.google.com/document/d/<id>/edit?usp=...
 *   bare file id
 */
export function parseDriveRef(input: string): DriveFileRef {
  if (!input) return { kind: "unknown", raw: input };

  // Spreadsheet
  const sheet = input.match(
    /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/,
  );
  if (sheet) return { kind: "spreadsheet", fileId: sheet[1] };

  // Document
  const doc = input.match(
    /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]{20,})/,
  );
  if (doc) return { kind: "document", fileId: doc[1] };

  // Drive file
  const file = input.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{20,})/);
  if (file) return { kind: "file", fileId: file[1] };

  // Drive open?id=
  const open = input.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]{20,})/);
  if (open) return { kind: "file", fileId: open[1] };

  // Bare file id (20+ chars, no path/URL chars)
  if (/^[a-zA-Z0-9_-]{20,}$/.test(input)) {
    return { kind: "file", fileId: input };
  }

  return { kind: "unknown", raw: input };
}

/**
 * Fetch a Drive file as binary. For Google-native types (Sheets, Docs,
 * Slides) the caller picks an export MIME type (e.g. "text/csv" for a
 * Sheet, "application/pdf" for a Doc). For uploaded binaries (PDF,
 * image, Office doc), the returned bytes are the raw file.
 */
export async function fetchDriveFile(
  ref: DriveFileRef,
  opts: { exportMime?: string } = {},
): Promise<{ ok: true; file: DriveFileContent } | { ok: false; error: string }> {
  if (ref.kind === "unknown") {
    return { ok: false, error: `Unrecognized Drive URL shape: ${ref.raw}` };
  }
  const drive = getDriveClient();
  if (!drive) {
    return {
      ok: false,
      error: "Drive client not configured (GMAIL_OAUTH_* env vars missing)",
    };
  }
  try {
    // Metadata first — we need the name + mimeType regardless.
    const meta = await drive.files.get({
      fileId: ref.fileId,
      fields: "id, name, mimeType, size",
      supportsAllDrives: true,
    });
    const name = meta.data.name ?? ref.fileId;
    const metaMime = meta.data.mimeType ?? "application/octet-stream";

    // Google-native types must use files.export, not files.get?alt=media.
    const isGoogleNative = metaMime.startsWith("application/vnd.google-apps.");

    let data: Buffer;
    let effectiveMime: string;
    let effectiveName = name;

    if (isGoogleNative) {
      const exportMime =
        opts.exportMime ??
        (metaMime === "application/vnd.google-apps.spreadsheet"
          ? "text/csv"
          : metaMime === "application/vnd.google-apps.document"
            ? "application/pdf"
            : metaMime === "application/vnd.google-apps.presentation"
              ? "application/pdf"
              : "application/pdf");
      const exp = await drive.files.export(
        { fileId: ref.fileId, mimeType: exportMime },
        { responseType: "arraybuffer" },
      );
      data = Buffer.from(exp.data as ArrayBuffer);
      effectiveMime = exportMime;
      // Adjust filename extension to match the exported mime
      const ext =
        exportMime === "text/csv"
          ? ".csv"
          : exportMime === "application/pdf"
            ? ".pdf"
            : "";
      if (ext && !effectiveName.endsWith(ext)) effectiveName += ext;
    } else {
      const r = await drive.files.get(
        { fileId: ref.fileId, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" },
      );
      data = Buffer.from(r.data as ArrayBuffer);
      effectiveMime = metaMime;
    }

    return {
      ok: true,
      file: {
        fileId: ref.fileId,
        name: effectiveName,
        mimeType: effectiveMime,
        data,
        size: data.byteLength,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Drive fetch failed: ${msg}` };
  }
}

/**
 * Convenience: accept a raw Drive URL or file id, fetch and return the
 * file. Handles the parse + fetch in one call.
 */
export async function fetchDriveFileByUrl(
  urlOrId: string,
  opts: { exportMime?: string } = {},
): Promise<{ ok: true; file: DriveFileContent } | { ok: false; error: string }> {
  return fetchDriveFile(parseDriveRef(urlOrId), opts);
}
