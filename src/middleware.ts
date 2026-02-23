/**
 * Route Protection Middleware — USA Gummies Operations Platform
 *
 * Uses getToken() from next-auth/jwt to avoid importing bcryptjs
 * (which uses Node.js crypto and is not Edge Runtime compatible).
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

import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

/** Routes that handle their own authentication (QStash signature, API key, etc.) */
const SELF_AUTHENTICATED_PREFIXES = [
  "/api/ops/scheduler/master",
  "/api/ops/engine/",
  "/api/ops/notify",
];

function isSelfAuthenticated(pathname: string): boolean {
  return SELF_AUTHENTICATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix)
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

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

  // Check JWT session
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  // Protect /ops/* pages — redirect to login
  if (pathname.startsWith("/ops")) {
    if (!token) {
      const loginUrl = new URL("/ops/login", req.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // Protect /api/agentic/* and /api/ops/* — return 401
  if (pathname.startsWith("/api/agentic") || pathname.startsWith("/api/ops")) {
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/ops/:path*",
    "/api/agentic/:path*",
    "/api/ops/:path*",
    "/command-center/:path*",
    "/command-center",
  ],
};
