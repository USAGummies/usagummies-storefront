/**
 * POST /api/ops/vendor/portal/issue
 *
 * Phase 31.2.a — issue a fresh vendor-portal URL for a registered
 * vendor.
 *
 * Body (JSON):
 *   {
 *     vendorId: string,    // kebab-case; must be in VENDOR_PORTAL_REGISTRY
 *     ttlDays?: number     // optional override; default 30 (TOKEN_DEFAULT_TTL_DAYS)
 *   }
 *
 * Response (200):
 *   {
 *     ok: true,
 *     vendorId: string,
 *     displayName: string,
 *     url: string,         // the public portal URL
 *     expiresAt: string,   // ISO
 *     ttlDays: number
 *   }
 *
 * **Hard rules:**
 *   - Auth-gated (`isAuthorized()` — session OR CRON_SECRET).
 *   - Vendor MUST be registered. Unregistered vendorId → 404. We
 *     never mint tokens for arbitrary kebab-case strings, even
 *     though the HMAC primitive would happily sign anything.
 *   - VENDOR_PORTAL_SECRET must be set. Missing → 500. We never
 *     mint a token signed with an empty key.
 *   - ttlDays clamped to [1, 90]. Outside that range → 400.
 *   - **Class A audit envelope** (`vendor.portal.issue`) records
 *     vendorId + expiresAt + actor. **Never logs the URL or the
 *     token** — those are bearer secrets.
 *   - This route does NOT send the URL via email. Sending is a
 *     downstream Class B `gmail.send` action (separate slug,
 *     separate route).
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditStore } from "@/lib/ops/control-plane/stores";
import {
  buildVendorPortalUrl,
  TOKEN_DEFAULT_TTL_DAYS,
} from "@/lib/ops/vendor-portal-token";
import { getVendorPortalEntry } from "@/lib/ops/vendor-portal-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_DAYS_MIN = 1;
const TTL_DAYS_MAX = 90;

interface IssueBody {
  vendorId?: unknown;
  ttlDays?: unknown;
}

function resolveBaseUrl(req: Request): string {
  // Prefer the explicit env override; fall back to the request's
  // origin so dev / preview deployments build the correct URL.
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  try {
    const u = new URL(req.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "https://www.usagummies.com";
  }
}

async function recordAudit(
  vendorId: string | null,
  ok: boolean,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    const run = newRunContext({
      agentId: "vendor-portal-issue",
      division: "production-supply-chain",
      source: "human-invoked",
      trigger: "vendor.portal.issue",
    });
    const entry = buildAuditEntry(run, {
      action: "vendor.portal.issue",
      entityType: "vendor",
      entityId: vendorId ?? "(unregistered)",
      after: detail,
      result: ok ? "ok" : "error",
      sourceCitations: [{ system: "vendor-portal-registry" }],
      confidence: 1,
    });
    await auditStore().append(entry);
  } catch {
    /* audit failure is non-fatal observability gap */
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const secret = process.env.VENDOR_PORTAL_SECRET?.trim();
  if (!secret) {
    await recordAudit(null, false, {
      reason: "VENDOR_PORTAL_SECRET env var is not set",
    });
    return NextResponse.json(
      {
        error:
          "VENDOR_PORTAL_SECRET not configured. Set it on Vercel before issuing tokens.",
      },
      { status: 500 },
    );
  }

  let body: IssueBody = {};
  try {
    body = (await req.json()) as IssueBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  const vendorId =
    typeof body.vendorId === "string" ? body.vendorId.trim() : "";
  if (!vendorId) {
    return NextResponse.json(
      { error: "Required field: vendorId" },
      { status: 400 },
    );
  }

  const entry = getVendorPortalEntry(vendorId);
  if (!entry) {
    await recordAudit(vendorId, false, {
      reason: "vendorId not in VENDOR_PORTAL_REGISTRY",
    });
    return NextResponse.json(
      {
        error: `Vendor not registered: ${vendorId}. Add to VENDOR_PORTAL_REGISTRY before issuing tokens.`,
      },
      { status: 404 },
    );
  }

  const rawTtl = body.ttlDays;
  const ttlDays =
    typeof rawTtl === "number" && Number.isFinite(rawTtl)
      ? Math.floor(rawTtl)
      : TOKEN_DEFAULT_TTL_DAYS;
  if (ttlDays < TTL_DAYS_MIN || ttlDays > TTL_DAYS_MAX) {
    return NextResponse.json(
      {
        error: `ttlDays must be in [${TTL_DAYS_MIN}, ${TTL_DAYS_MAX}]; got ${ttlDays}.`,
      },
      { status: 400 },
    );
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");

  let url: string;
  try {
    url = buildVendorPortalUrl({
      baseUrl: resolveBaseUrl(req),
      vendorId,
      expiresAt,
      secret,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordAudit(vendorId, false, {
      reason: `buildVendorPortalUrl threw: ${msg}`,
    });
    return NextResponse.json(
      { error: `Failed to build URL: ${msg}` },
      { status: 500 },
    );
  }

  // Audit envelope — NEVER includes the URL or the token (those are
  // bearer secrets). Only the metadata that's safe to log.
  await recordAudit(vendorId, true, {
    displayName: entry.displayName,
    expiresAt,
    ttlDays,
    coiDriveFolderConfigured: entry.coiDriveFolderId !== null,
    defaultEmailConfigured: entry.defaultEmail !== null,
  });

  return NextResponse.json({
    ok: true,
    vendorId,
    displayName: entry.displayName,
    url,
    expiresAt,
    ttlDays,
  });
}
