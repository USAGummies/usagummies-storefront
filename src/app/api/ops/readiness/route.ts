/**
 * GET /api/ops/readiness
 *
 * Read-only env fingerprint for the operator dashboard. Reads
 * `process.env` and returns ONLY booleans plus the structured rows
 * derived by `deriveEnvStatus()`. The route never:
 *   - exposes raw env values
 *   - writes anything (KV / QBO / Gmail / Drive / Slack)
 *   - probes or fetches other ops routes server-side
 *
 * Probes against other endpoints happen client-side from the operator's
 * browser, where the session cookie travels naturally — that keeps
 * server-to-server auth out of the picture and makes "what does the
 * operator's session see?" the truth.
 *
 * Auth: middleware blocks `/api/ops/*` for unauthenticated traffic;
 * `isAuthorized()` re-checks (session OR CRON_SECRET) inside the route.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  deriveEnvStatus,
  SMOKE_CHECKLIST,
  type EnvFingerprint,
} from "@/lib/readiness/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPresent(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

function fingerprint(): EnvFingerprint {
  return {
    GMAIL_OAUTH_CLIENT_ID:
      isPresent("GMAIL_OAUTH_CLIENT_ID") || isPresent("GCP_GMAIL_OAUTH_CLIENT_ID"),
    GMAIL_OAUTH_CLIENT_SECRET:
      isPresent("GMAIL_OAUTH_CLIENT_SECRET") ||
      isPresent("GCP_GMAIL_OAUTH_CLIENT_SECRET"),
    GMAIL_OAUTH_REFRESH_TOKEN:
      isPresent("GMAIL_OAUTH_REFRESH_TOKEN") ||
      isPresent("GCP_GMAIL_OAUTH_REFRESH_TOKEN"),
    GOOGLE_DRIVE_UPLOAD_PARENT_ID: isPresent("GOOGLE_DRIVE_UPLOAD_PARENT_ID"),
    GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID: isPresent(
      "GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID",
    ),
    GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID: isPresent(
      "GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID",
    ),
    WHOLESALE_INQUIRY_SECRET: isPresent("WHOLESALE_INQUIRY_SECRET"),
    SLACK_BOT_TOKEN: isPresent("SLACK_BOT_TOKEN"),
    SLACK_SIGNING_SECRET: isPresent("SLACK_SIGNING_SECRET"),
    CRON_SECRET: isPresent("CRON_SECRET"),
    KV_REST_API_URL: isPresent("KV_REST_API_URL"),
    KV_REST_API_TOKEN: isPresent("KV_REST_API_TOKEN"),
  };
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const env = deriveEnvStatus(fingerprint());

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    env,
    smokeChecklist: SMOKE_CHECKLIST,
    /**
     * Routes the dashboard page should client-side probe. Server-side
     * does NOT probe these — the operator's browser session carries
     * the right auth.
     */
    probes: [
      {
        url: "/api/ops/control-plane/health",
        label: "Control plane health",
      },
      {
        url: "/api/ops/fulfillment/recent-labels?limit=1",
        label: "Recent labels (read-only)",
      },
      {
        url: "/api/ops/docs/receipt?summary=true",
        label: "Receipt queue summary",
      },
      { url: "/api/ops/ap-packets", label: "AP packets list" },
      { url: "/api/ops/locations/ingest", label: "Location ingest queue" },
    ],
  });
}
