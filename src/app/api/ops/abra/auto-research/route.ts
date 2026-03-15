import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  runAutoResearchEval,
  getRecentRuns,
  getPromptVersions,
  getSupportedTargets,
} from "@/lib/ops/auto-research-runner";
import { generateMutation } from "@/lib/ops/auto-research-mutator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // Eval runs can take a while

/**
 * GET: Retrieve eval history, prompt versions, and scores
 *
 * Query params:
 *   target_key — which agent to query (default: email_drafter)
 *   limit      — max runs to return (default: 20)
 *   list_targets — if "true", return list of all supported targets
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);

    // List all supported targets
    if (url.searchParams.get("list_targets") === "true") {
      return NextResponse.json({ targets: getSupportedTargets() });
    }

    const targetKey = url.searchParams.get("target_key") || "email_drafter";
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);

    const [runs, versions] = await Promise.all([
      getRecentRuns(targetKey, limit),
      getPromptVersions(targetKey),
    ]);

    return NextResponse.json({
      target_key: targetKey,
      supported_targets: getSupportedTargets(),
      runs,
      versions,
      active_version: versions.find((v) => v.status === "active") || null,
      candidate_versions: versions.filter((v) => v.status === "candidate"),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

/**
 * POST: Trigger an eval run and optionally a mutation
 *
 * Body: {
 *   target_key: string (default: "email_drafter")
 *   sample_size: number (default: 10)
 *   run_mutation: boolean (default: false)
 *   mutation_only: boolean (default: false) — skip eval, only generate mutation
 * }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      target_key?: string;
      sample_size?: number;
      run_mutation?: boolean;
      mutation_only?: boolean;
    };

    const targetKey = body.target_key || "email_drafter";
    const sampleSize = body.sample_size || 10;

    // Mutation only mode
    if (body.mutation_only) {
      const mutation = await generateMutation({ target_key: targetKey });
      return NextResponse.json({ mutation });
    }

    // Run eval
    const evalResult = await runAutoResearchEval({
      target_key: targetKey,
      sample_size: sampleSize,
    });

    // Optionally generate mutation after eval
    let mutation = null;
    if (body.run_mutation) {
      const activeRun = evalResult.runs.find((r) => {
        return !evalResult.promoted || r.version !== evalResult.promoted_version;
      });
      if (activeRun) {
        mutation = await generateMutation({
          target_key: targetKey,
          criteria_scores: activeRun.criteria_scores,
        });
      }
    }

    return NextResponse.json({
      eval: evalResult,
      mutation,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
