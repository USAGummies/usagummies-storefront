/**
 * Route Protection Middleware — USA Gummies Operations Platform
 *
 * Uses NextAuth v5's `auth()` middleware wrapper — handles cookie names,
 * secrets, and session parsing automatically (no manual getToken).
 *
 * Protects:
 *   /ops/*          → redirect to /ops/login if unauthenticated
 *   /api/agentic/*  → 401 if unauthenticated
 *   /api/ops/*      → 401 if unauthenticated
 *
 * Exceptions (self-authenticated routes — verify QStash sig / API key internally):
 *   /api/ops/scheduler/master  → Vercel Cron (CRON_SECRET verified in route)
 *   /api/ops/engine/*          → QStash callbacks (signature verified in route)
 *   /api/ops/notify            → Internal notifications endpoint
 *
 * Public routes (storefront, blog, shop, etc.) are unaffected.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";

/** Routes that handle their own authentication (QStash signature, API key, CRON_SECRET, etc.) */
const SELF_AUTHENTICATED_PREFIXES = [
  "/api/ops/scheduler/master",
  "/api/ops/engine/",
  "/api/ops/notify",
  "/api/ops/slack/",
  "/api/ops/control-plane/", // 3.0 control plane — isCronAuthorized() (Bearer CRON_SECRET) on reads + low-auth writes; isAdminAuthorized() (X-Admin-Authorization) on /unpause
  "/api/ops/daily-brief", // 3.0 daily brief — isCronAuthorized() (Bearer CRON_SECRET); scheduled by Make.com
  "/api/ops/abra/", // All Abra routes use isAuthorized() from abra-auth.ts (session + CRON_SECRET)
  "/api/ops/department/", // Department API uses isAuthorized() (session + CRON_SECRET)
  "/api/ops/plaid/", // Plaid endpoints — balance used by Abra crons, webhook verified by item_id
  "/api/ops/gmail-callback", // One-time OAuth callback for Gmail setup
  "/api/ops/qbo/", // QBO OAuth flow + setup (authorize, callback, setup)
  "/api/ops/amazon-ads/", // Amazon Advertising API — uses isAuthorized() (CRON_SECRET)
  "/api/ops/puzzle/", // Puzzle OAuth flow
  "/api/ops/sweeps/", // Sweep runners — auth via CRON_SECRET or QStash signature
  "/api/ops/workflows/", // Workflow engine — auth handled in route
  "/api/ops/approvals", // Approvals — GET uses hasApprovalsReadAccess (session + CRON_SECRET), POST requires session
  "/api/ops/forge/", // FORGE — Production & Supply Chain tracking (isAuthorized)
  "/api/ops/archive/", // ARCHIVE — Data backup & Notion sync (isAuthorized)
  "/api/ops/freight/", // FREIGHT — Shipping & Logistics tracking + rate-shop (isAuthorized / CRON_SECRET)
  "/api/ops/pulse/", // PULSE — Fleet health monitoring (isAuthorized)
  "/api/ops/ledger/", // LEDGER — Bookkeeping, decisions, COA routing (isAuthorized)
  "/api/ops/inventory/", // INVENTORY — Batch register, unit costs, on-hand (isAuthorized)
  "/api/ops/orders/", // ORDER DESK — Order log, fulfillment, samples (isAuthorized)
  "/api/ops/customers/", // CUSTOMERS — Amazon FBM registry; future cross-channel (isAuthorized session + CRON_SECRET)
  "/api/ops/stack-readiness", // STACK READINESS — external service health surface, Phase 28L.3 (isAuthorized session + CRON_SECRET)
  "/api/ops/uspto/", // USPTO — trademark tracking + deadline surface, Phase 31.1 (isAuthorized session + CRON_SECRET)
  "/api/ops/vendor/", // VENDOR PORTAL — operator-side token issuance + admin, Phase 31.2.a (isAuthorized session + CRON_SECRET). Note: the public /api/vendor/[token]/* routes are SEPARATE — they live under /api/vendor (no /ops/) and self-authenticate via HMAC.
  "/api/ops/vendors/", // VENDOR ONBOARDING — /ops/vendors/new + onboard route (vendor.master.create Class B approvals to Rene). isAuthorized() (session OR CRON_SECRET) inside the route.
  "/api/ops/fulfillment", // FULFILLMENT — Unified ship-today queue (session or CRON_SECRET)
  "/api/ops/shipping/", // SHIPPING — Unified auto-ship pipeline (session or CRON_SECRET)
  "/api/ops/ap-packets", // AP PACKETS — vendor setup reply pipeline (Gmail send with dedup + approval gate). No trailing slash so both /ap-packets and /ap-packets/send match.
  "/api/ops/viktor/", // VIKTOR runtime — W-7 Rene-capture etc. (isCronAuthorized bearer CRON_SECRET)
  "/api/ops/agents/", // Specialist agent runtimes — finance-exception, ops, etc. (isAuthorized session + CRON_SECRET)
  "/api/ops/booke/", // Booke queue push/query (isCronAuthorized bearer CRON_SECRET)
  "/api/ops/research/", // Research notes push/list (isCronAuthorized bearer CRON_SECRET)
  "/api/ops/shipstation/", // ShipStation diagnostics (isCronAuthorized)
  "/api/ops/docs/", // DOCS — Document extraction, transcription, receipts (isAuthorized)
  "/api/ops/pipeline/", // PIPELINE — Sales CRM, follow-ups, lead scoring (isAuthorized)
  "/api/ops/amazon/", // AMAZON — FBA inventory, restock, PPC, listing health (isAuthorized)
  "/api/ops/alerts/", // ALERTS — Dedup registry (isAuthorized)
  "/api/ops/claims/", // CLAIMS — Product claim verification gate (isAuthorized)
  "/api/ops/pulse/", // PULSE — Fleet health monitoring (isAuthorized)
  "/api/ops/webhooks/", // WEBHOOKS — Upstream webhook ingress (Shopify HMAC, Amazon SNS, Faire token, etc.) — each route verifies its own signature
  "/api/ops/smoke", // SMOKE — cross-integration health check (isAuthorized)
  "/api/ops/shopify/", // SHOPIFY DTC — unfulfilled queue + dispatch bridge (isAuthorized)
  "/api/ops/upload", // UPLOAD — public-facing NCS-001 / vendor-doc capture (used by /upload/ncs and the wholesale inquiry receipt page). Route enforces its own perimeter: rate limit (5/min/IP), MIME allowlist, 10 MB cap, Drive-only writes (fail-closed if env missing).
  "/api/ops/wholesale/onboarding", // WHOLESALE ONBOARDING — Rene's stalled-flow review surface + daily digest (Phase 35.f.5 + 35.f.5.b). isAuthorized() session + CRON_SECRET. NOTE: the trailing-slash-less prefix matches both /onboarding (read) and /onboarding-digest (cron-fired Slack post).
  "/api/ops/wholesale/completed", // WHOLESALE COMPLETED — monthly-close audit envelope query surface, Phase 35.f.6.b (isAuthorized session + CRON_SECRET).
  "/api/ops/wholesale/chase-email", // WHOLESALE CHASE EMAIL — draft chase email for a stalled flow, Phase 35.f.7 (isAuthorized session + CRON_SECRET, read-only never sends).
];

function isSelfAuthenticated(pathname: string): boolean {
  return SELF_AUTHENTICATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix)
  );
}

const OPERATOR_ROLES = new Set(["admin", "employee"]);
const READONLY_ROLES = new Set(["admin", "employee", "investor", "partner", "banker"]);

function roleFromSession(session: any): string {
  return String(session?.user?.role || "employee").toLowerCase();
}

function isReadMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  // Allow login page and auth API routes without session
  if (pathname === "/ops/login" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  // Allow self-authenticated routes (QStash, Vercel Cron) — they verify internally
  if (isSelfAuthenticated(pathname)) {
    return NextResponse.next();
  }

  // Legacy /command-center → redirect to /ops/agents
  if (pathname === "/command-center" || pathname.startsWith("/command-center")) {
    return NextResponse.redirect(new URL("/ops/agents", req.url));
  }

  // req.auth is populated automatically by the auth() wrapper
  const session = req.auth;
  const role = roleFromSession(session);

  // Protect /ops/* pages — redirect to login
  if (pathname.startsWith("/ops")) {
    if (!session) {
      const loginUrl = new URL("/ops/login", req.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Defense-in-depth: protect pages that should not be available to readonly roles
    if (pathname.startsWith("/ops/settings") && role !== "admin") {
      return NextResponse.redirect(new URL("/ops", req.url));
    }
    if (pathname.startsWith("/ops/inbox") && !OPERATOR_ROLES.has(role)) {
      return NextResponse.redirect(new URL("/ops", req.url));
    }
    return NextResponse.next();
  }

  // Protect /api/agentic/* and /api/ops/* — return 401
  if (pathname.startsWith("/api/agentic")) {
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Read-only agent dashboard can be exposed to investor/partner/banker roles.
    if (pathname === "/api/agentic/command-center" && isReadMethod(method)) {
      if (!READONLY_ROLES.has(role)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.next();
    }

    if (!OPERATOR_ROLES.has(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/ops")) {
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Settings is always admin-only (read and write).
    if (pathname.startsWith("/api/ops/settings") && role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const allowedRoles = isReadMethod(method) ? READONLY_ROLES : OPERATOR_ROLES;
    if (!allowedRoles.has(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.next();
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/ops/:path*",
    "/api/agentic/:path*",
    "/api/ops/:path*",
    "/command-center/:path*",
    "/command-center",
  ],
};
