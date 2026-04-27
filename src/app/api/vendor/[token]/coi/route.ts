/**
 * POST /api/vendor/[token]/coi
 *
 * Phase 31.2.c — public COI upload endpoint.
 *
 * **NOT under /api/ops/.** This is the public-facing entrypoint
 * that vendors call after clicking the URL in their email. The
 * route is NOT covered by NextAuth middleware; it self-
 * authenticates via the HMAC token in the URL path.
 *
 * Flow:
 *   1. Verify the URL token via `verifyVendorPortalToken`. Reject
 *      on missing-token / missing-secret / malformed / invalid-
 *      vendor-id / invalid-expiry / signature-mismatch / expired.
 *   2. Look up the vendor in `VENDOR_PORTAL_REGISTRY`. The HMAC
 *      passing tells us "the URL was minted with our secret"; the
 *      registry tells us "this vendor is configured to accept
 *      uploads." Both gates must pass.
 *   3. Parse multipart/form-data; extract `file` field.
 *   4. Validate MIME + size (reuses constants from drive-upload.ts).
 *   5. Write to the vendor's `coiDriveFolderId` via
 *      `uploadVendorCoi`.
 *   6. Audit envelope `vendor.coi.upload` (Class A — auto-attach to
 *      dossier per the interviewer-pre-build defaults). Records
 *      vendorId, file size, fileId, parentFolderId, **but not the
 *      original filename verbatim** (PII-flavored).
 *   7. Return `{ok, fileId, fileName, size}` on success; typed
 *      error otherwise.
 *
 * Hard rules (security-critical):
 *   - **Reject expired/tampered tokens BEFORE reading the body.**
 *     We don't accept multipart from unauthenticated callers.
 *   - **Constant-time HMAC compare** (handled by the underlying
 *     primitive).
 *   - **Reasonable size cap** (10MB) enforced upstream of the Drive
 *     write.
 *   - **No vendor-id leakage** on token verification failure
 *     (handled by the underlying primitive).
 */
import { NextResponse } from "next/server";

import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditStore } from "@/lib/ops/control-plane/stores";
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_BYTES,
} from "@/lib/ops/drive-upload";
import { uploadVendorCoi } from "@/lib/ops/vendor-coi-upload";
import { getVendorPortalEntry } from "@/lib/ops/vendor-portal-registry";
import { verifyVendorPortalToken } from "@/lib/ops/vendor-portal-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ token: string }>;
}

async function recordAudit(
  vendorId: string | null,
  ok: boolean,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    const run = newRunContext({
      agentId: "vendor-coi-upload",
      division: "production-supply-chain",
      source: "event",
      trigger: "vendor.coi.upload",
    });
    const entry = buildAuditEntry(run, {
      action: "vendor.coi.upload",
      entityType: "vendor",
      entityId: vendorId ?? "(unverified)",
      after: detail,
      result: ok ? "ok" : "error",
      sourceCitations: [{ system: "vendor-portal" }],
      confidence: 1,
    });
    await auditStore().append(entry);
  } catch {
    /* audit failure is non-fatal observability gap */
  }
}

export async function POST(
  req: Request,
  ctx: RouteContext,
): Promise<Response> {
  const { token } = await ctx.params;
  const secret = process.env.VENDOR_PORTAL_SECRET?.trim();

  // Step 1: verify token. NEVER read the body before this.
  const verify = verifyVendorPortalToken(token, secret ?? null, new Date());
  if (!verify.ok) {
    await recordAudit(null, false, {
      reason: `token-verify failed: ${verify.reason}`,
    });
    // Use 401 for crypto failures (signature, missing) and 410
    // (Gone) for expired — distinct status helps the UI surface
    // the right message.
    if (verify.reason === "expired") {
      return NextResponse.json(
        { error: "This portal link has expired. Request a new one." },
        { status: 410 },
      );
    }
    return NextResponse.json(
      { error: "Invalid portal link." },
      { status: 401 },
    );
  }

  const vendorId = verify.vendorId!;
  const entry = getVendorPortalEntry(vendorId);
  if (!entry) {
    // HMAC passed but vendor is no longer registered (operator
    // removed them). Refuse — same as the issue route's defense.
    await recordAudit(vendorId, false, {
      reason: "vendor not in registry",
    });
    return NextResponse.json(
      { error: "Vendor configuration not found." },
      { status: 404 },
    );
  }
  if (!entry.coiDriveFolderId) {
    await recordAudit(vendorId, false, {
      reason: "coiDriveFolderId is null in registry entry",
    });
    return NextResponse.json(
      {
        error:
          "Upload destination not configured. Contact your USA Gummies AP rep.",
      },
      { status: 503 },
    );
  }

  // Step 2: parse multipart body.
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordAudit(vendorId, false, { reason: `formData parse: ${msg}` });
    return NextResponse.json(
      { error: "Invalid multipart body." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!file || typeof file === "string" || !(file instanceof File)) {
    await recordAudit(vendorId, false, { reason: "no file field" });
    return NextResponse.json(
      { error: "Required field: file (multipart)." },
      { status: 400 },
    );
  }

  // Step 3: validate MIME + size before reading bytes (defense
  // against giant uploads — File.size is metadata).
  if (file.size === 0) {
    await recordAudit(vendorId, false, { reason: "empty file" });
    return NextResponse.json(
      { error: "File is empty." },
      { status: 400 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    await recordAudit(vendorId, false, {
      reason: `file exceeds ${MAX_UPLOAD_BYTES} bytes (got ${file.size})`,
    });
    return NextResponse.json(
      {
        error: `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB limit.`,
      },
      { status: 413 },
    );
  }
  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(file.type)) {
    await recordAudit(vendorId, false, {
      reason: `MIME not allowed: ${file.type}`,
    });
    return NextResponse.json(
      {
        error: `File type not allowed (got ${file.type}). Use PDF, PNG, JPG, or DOC.`,
      },
      { status: 415 },
    );
  }

  // Step 4: read bytes and upload.
  const arrayBuf = await file.arrayBuffer();
  const data = Buffer.from(arrayBuf);
  const result = await uploadVendorCoi({
    vendorId,
    displayName: entry.displayName,
    fileName: file.name,
    data,
    mimeType: file.type,
    parentFolderId: entry.coiDriveFolderId,
  });

  if (!result.ok) {
    await recordAudit(vendorId, false, {
      code: result.code,
      error: result.error,
    });
    const status =
      result.code === "validation_failed"
        ? 400
        : result.code === "drive_oauth_missing"
          ? 503
          : 502;
    return NextResponse.json({ error: result.error }, { status });
  }

  // Audit success. Don't include the verbatim original filename
  // (PII-flavored — could carry vendor org structure).
  await recordAudit(vendorId, true, {
    fileId: result.fileId,
    driveName: result.name,
    parentFolderId: result.parentFolderId,
    size: result.size,
    mimeType: result.mimeType,
  });

  return NextResponse.json({
    ok: true,
    fileId: result.fileId,
    fileName: result.name,
    size: result.size,
  });
}
