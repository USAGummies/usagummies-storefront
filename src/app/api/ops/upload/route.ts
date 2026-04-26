/**
 * File Upload API — POST /api/ops/upload
 *
 * Public-facing customer-form upload endpoint. Used by:
 *   - /upload/ncs   (NCS-001 customer setup form, public)
 *   - operator UIs that POST W-9 / COI / vendor-form documents
 *
 * Storage: Google Drive (durable). Earlier versions wrote to the local
 * filesystem; that broke on Vercel because the /uploads directory
 * disappears on every redeploy. We now fail closed when Drive is not
 * configured rather than silently lose customer files.
 *
 * Body (multipart/form-data):
 *   - file: the uploaded file        (required)
 *   - customer_name | submitter      (display name; sanitized for filename)
 *   - doc_type | form_type           ("ncs" | "w9" | "coi" | "receipt" | "vendor-form" | "other")
 *   - notes                          (optional, ≤ 1000 chars)
 *
 * Validation:
 *   - file present + non-empty
 *   - mime ∈ allow-list (pdf, common images, doc/docx, heic)
 *   - size ≤ 10 MB
 *
 * Rate limit: 5 uploads / minute / IP. Public endpoint — even though
 * we validate the file, an unauthenticated upload form is a risk
 * surface. The limiter fails open if KV is unreachable so a brief KV
 * outage doesn't break legitimate uploads.
 */

import { NextResponse } from "next/server";

import {
  ALLOWED_UPLOAD_MIME_TYPES,
  DOC_TYPES,
  MAX_UPLOAD_BYTES,
  uploadDurableFile,
  type DocType,
} from "@/lib/ops/drive-upload";
import { checkRateLimit, rateLimitResponse } from "@/lib/ops/rate-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 5,
  keyPrefix: "rl:upload",
} as const;

function normalizeDocType(raw: string): DocType {
  const lower = raw.trim().toLowerCase();
  if ((DOC_TYPES as readonly string[]).includes(lower)) {
    return lower as DocType;
  }
  // Backward-compat: previous form_type used "ncs" | "cif" | "booth" | "other".
  // Map cif/booth → "other" so existing callers don't blow up.
  if (lower === "cif" || lower === "booth") return "other";
  return "other";
}

function getRequestIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return (
    forwarded?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    "anonymous"
  );
}

export async function POST(req: Request) {
  // 1. Rate limit (public endpoint).
  const ip = getRequestIp(req);
  const rl = await checkRateLimit(ip, RATE_LIMIT);
  if (!rl.allowed) {
    return rateLimitResponse(rl);
  }

  // 2. Parse multipart body.
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid multipart body" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  const submitter = (
    (formData.get("customer_name") as string | null) ||
    (formData.get("submitter") as string | null) ||
    "unknown"
  ).trim();
  const rawDocType =
    (formData.get("doc_type") as string | null) ||
    (formData.get("form_type") as string | null) ||
    "ncs";
  const notes = ((formData.get("notes") as string | null) || "").trim().slice(0, 1000);

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { ok: false, error: "No file uploaded" },
      { status: 400 },
    );
  }

  // 3. Validate mime + size BEFORE buffering the whole file (fail fast).
  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(file.type)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "File type not allowed. Please upload a PDF, image (PNG/JPG/HEIC), or Word document.",
        mime: file.type,
      },
      { status: 415 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB.`,
      },
      { status: 413 },
    );
  }

  const docType = normalizeDocType(rawDocType);

  // 4. Buffer + upload to Drive.
  const arrayBuffer = await file.arrayBuffer();
  const data = Buffer.from(arrayBuffer);

  const result = await uploadDurableFile({
    fileName: file.name,
    data,
    mimeType: file.type,
    docType,
    submitter,
    notes: notes || undefined,
  });

  if (!result.ok) {
    // Fail-closed for env / scope problems: tell the operator clearly,
    // never silently write to local disk.
    const status =
      result.code === "drive_not_configured" || result.code === "drive_oauth_missing"
        ? 503
        : result.code === "validation_failed"
          ? 400
          : 502;
    // Best-effort Slack alert so we know configuration broke.
    notifySlack({
      kind: "upload_failed",
      docType,
      submitter,
      reason: result.code,
      detail: result.error,
    }).catch(() => void 0);
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        code: result.code,
      },
      { status },
    );
  }

  // 5. Notify Slack (best effort).
  notifySlack({
    kind: "upload_succeeded",
    docType,
    submitter,
    fileName: result.name,
    fileId: result.fileId,
    size: result.size,
    webViewLink: result.webViewLink,
    notes: notes || undefined,
  }).catch(() => void 0);

  return NextResponse.json({
    ok: true,
    fileId: result.fileId,
    name: result.name,
    mimeType: result.mimeType,
    size: result.size,
    webViewLink: result.webViewLink,
    parentFolderId: result.parentFolderId,
    docType,
    submitter,
    message: "File uploaded successfully. We'll process it shortly.",
  });
}

// ---------------------------------------------------------------------------

interface SlackNotifyArgs {
  kind: "upload_succeeded" | "upload_failed";
  docType: DocType;
  submitter: string;
  fileName?: string;
  fileId?: string;
  size?: number;
  webViewLink?: string | null;
  reason?: string;
  detail?: string;
  notes?: string;
}

async function notifySlack(args: SlackNotifyArgs): Promise<void> {
  const webhook = process.env.SLACK_SUPPORT_WEBHOOK_URL;
  if (!webhook) return;
  const time = new Date().toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
  });
  const text =
    args.kind === "upload_succeeded"
      ? [
          `:open_file_folder: *Durable upload — ${args.docType.toUpperCase()}*`,
          `• Submitter: ${args.submitter}`,
          `• File: ${args.fileName ?? "(no name)"} (${args.size ? `${(args.size / 1024).toFixed(1)} KB` : "?"})`,
          args.webViewLink ? `• Drive: ${args.webViewLink}` : `• Drive id: ${args.fileId}`,
          args.notes ? `• Notes: ${args.notes}` : null,
          `• Time: ${time}`,
        ]
          .filter(Boolean)
          .join("\n")
      : [
          `:warning: *Upload failed — ${args.docType.toUpperCase()}*`,
          `• Submitter: ${args.submitter}`,
          `• Reason: \`${args.reason}\``,
          args.detail ? `• Detail: ${args.detail.slice(0, 300)}` : null,
          `• Time: ${time}`,
        ]
          .filter(Boolean)
          .join("\n");
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}
