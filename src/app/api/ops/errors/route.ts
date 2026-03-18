import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  getRecentErrors,
  resolveError,
  getErrorStats,
  type ErrorSeverity,
} from "@/lib/ops/error-tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/ops/errors — list recent errors with optional filters (auth required)
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const params = req.nextUrl.searchParams;
    const includeStats = params.get("stats") === "1";
    const limit = Math.min(
      Math.max(parseInt(params.get("limit") || "50", 10) || 50, 1),
      200,
    );

    const severity = params.get("severity") as ErrorSeverity | null;
    const source = params.get("source") || undefined;
    const resolvedParam = params.get("resolved");
    const resolved =
      resolvedParam === "true"
        ? true
        : resolvedParam === "false"
          ? false
          : undefined;

    const [errors, stats] = await Promise.all([
      getRecentErrors(limit, {
        severity: severity || undefined,
        source,
        resolved,
      }),
      includeStats ? getErrorStats() : Promise.resolve(null),
    ]);

    return NextResponse.json({
      errors,
      ...(stats ? { stats } : {}),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[api/ops/errors] GET failed:", err);
    return NextResponse.json(
      { errors: [], error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/ops/errors — resolve an error by ID
// ---------------------------------------------------------------------------

type PatchBody = {
  errorId?: string;
  resolvedBy?: string;
};

export async function PATCH(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as PatchBody;
    const errorId = body.errorId?.trim();
    const resolvedBy = body.resolvedBy?.trim() || "unknown";

    if (!errorId) {
      return NextResponse.json(
        { error: "errorId is required" },
        { status: 400 },
      );
    }

    const ok = await resolveError(errorId, resolvedBy);
    if (!ok) {
      return NextResponse.json(
        { error: "Failed to resolve error — Supabase may be unavailable" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      errorId,
      resolvedBy,
      resolvedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[api/ops/errors] PATCH failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
