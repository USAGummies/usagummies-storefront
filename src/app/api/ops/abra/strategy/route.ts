import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  buildCrossDepartmentStrategy,
  type StrategyDepth,
} from "@/lib/ops/abra-strategy-orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function normalizeDepth(value: unknown): StrategyDepth {
  return value === "quick" ? "quick" : "deep";
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: {
    objective?: unknown;
    topic?: unknown;
    mode?: unknown;
    depth?: unknown;
  } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const objective =
    typeof payload.objective === "string" ? payload.objective.trim() : "";
  const topic = typeof payload.topic === "string" ? payload.topic.trim() : null;
  const queryMode = new URL(req.url).searchParams.get("mode");
  const depth = normalizeDepth(payload.depth ?? payload.mode ?? queryMode);
  if (!objective) {
    return NextResponse.json({ error: "objective is required" }, { status: 400 });
  }

  const session = await auth().catch(() => null);
  const host =
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : new URL(req.url).origin);
  const cookieHeader = req.headers.get("cookie") || "";

  try {
    const strategy = await buildCrossDepartmentStrategy({
      objective,
      topic,
      depth,
      host,
      cookieHeader,
      actorEmail: session?.user?.email || null,
    });

    return NextResponse.json({
      mode: strategy.depth,
      strategy,
      approval_policy:
        "External submissions require explicit approval. Auto-execution is disabled by default.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Strategy generation failed",
      },
      { status: 500 },
    );
  }
}
