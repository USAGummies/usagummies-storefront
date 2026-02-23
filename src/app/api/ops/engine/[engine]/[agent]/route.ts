/**
 * POST /api/ops/engine/[engine]/[agent] — Universal agent executor
 *
 * Called by QStash (from master scheduler) or directly (manual trigger).
 * Dynamically imports the engine module and runs the specified agent.
 *
 * Security: Verifies QStash signature OR requires auth session.
 * Timeout: 300s (Vercel Pro) for long-running agents.
 */

import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { ENGINE_REGISTRY } from "@/lib/ops/engine-schedule";
import { appendStateArray } from "@/lib/ops/state";
import { notifyAlert } from "@/lib/ops/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min (Vercel Pro)

// ---------------------------------------------------------------------------
// QStash signature verification
// ---------------------------------------------------------------------------

function getReceiver(): Receiver | null {
  const signingKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!signingKey || !nextSigningKey) return null;
  return new Receiver({ currentSigningKey: signingKey, nextSigningKey });
}

async function verifyQStash(req: NextRequest, body: string): Promise<boolean> {
  const receiver = getReceiver();
  if (!receiver) return false;

  const signature = req.headers.get("upstash-signature");
  if (!signature) return false;

  try {
    await receiver.verify({ signature, body });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function etTimestamp(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace(",", "");
}

type ExecutionRecord = {
  engineId: string;
  agentKey: string;
  agentName: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: "running" | "success" | "failed";
  error?: string;
  triggeredBy: string;
};

// ---------------------------------------------------------------------------
// POST — Execute an agent
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ engine: string; agent: string }> }
) {
  const { engine: engineId, agent: agentKey } = await params;
  const rawBody = await req.text();
  let bodyJson: Record<string, unknown> = {};
  try {
    bodyJson = JSON.parse(rawBody);
  } catch {
    // Non-JSON body is ok for QStash
  }

  const triggeredBy = (bodyJson.triggeredBy as string) || "unknown";

  // --- Auth check: QStash signature OR authenticated session ---
  const isQStash = await verifyQStash(req, rawBody);
  if (!isQStash) {
    // Check for auth token (API key or session)
    const authHeader = req.headers.get("authorization");
    const apiKey = process.env.OPS_API_KEY;
    if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
      // Try next-auth session check
      const { getToken } = await import("next-auth/jwt");
      const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
      if (!token) {
        return NextResponse.json(
          { error: "Unauthorized — requires QStash signature or auth" },
          { status: 401 }
        );
      }
    }
  }

  // --- Validate engine + agent ---
  const engine = ENGINE_REGISTRY.find((e) => e.id === engineId);
  if (!engine) {
    return NextResponse.json(
      { error: `Engine "${engineId}" not found` },
      { status: 404 }
    );
  }
  const agent = engine.agents.find((a) => a.key === agentKey);
  if (!agent) {
    return NextResponse.json(
      { error: `Agent "${agentKey}" not found in engine "${engineId}"` },
      { status: 404 }
    );
  }

  const record: ExecutionRecord = {
    engineId,
    agentKey,
    agentName: agent.name,
    startedAt: etTimestamp(),
    status: "running",
    triggeredBy,
  };

  const startTime = Date.now();

  try {
    // --- Dynamic import and execution ---
    // Each engine exports a runAgent(key) function that executes a single agent
    const engineModule = await importEngine(engineId);

    if (!engineModule?.runAgent) {
      throw new Error(`Engine "${engineId}" does not export runAgent()`);
    }

    const result = await engineModule.runAgent(agentKey);

    const durationMs = Date.now() - startTime;
    record.completedAt = etTimestamp();
    record.durationMs = durationMs;
    record.status = result?.status === "failed" ? "failed" : "success";

    await appendStateArray("run-ledger", [record], 10000);

    return NextResponse.json({
      ok: true,
      engine: engineId,
      agent: agentKey,
      name: agent.name,
      status: record.status,
      durationMs,
      result: result?.summary || "completed",
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);

    record.completedAt = etTimestamp();
    record.durationMs = durationMs;
    record.status = "failed";
    record.error = errorMsg;

    await appendStateArray("run-ledger", [record], 10000);

    // Notify on failure
    await notifyAlert(
      `🔴 Agent failed: ${agent.name} (${engineId}/${agentKey})\nError: ${errorMsg}\nDuration: ${durationMs}ms`
    ).catch(() => {});

    return NextResponse.json(
      {
        ok: false,
        engine: engineId,
        agent: agentKey,
        name: agent.name,
        status: "failed",
        error: errorMsg,
        durationMs,
      },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Engine importer — maps engine ID to the module
// ---------------------------------------------------------------------------

type EngineModule = {
  runAgent: (agentKey: string) => Promise<{ status: string; summary?: string }>;
};

async function importEngine(engineId: string): Promise<EngineModule | null> {
  // Phase 3D: These will be TypeScript modules in src/lib/ops/engines/
  // For now, we provide a shim that explains the engines aren't yet extracted
  const engineMap: Record<string, () => Promise<EngineModule>> = {
    // These will be populated as engines are extracted to TS modules:
    // "b2b": () => import("@/lib/ops/engines/b2b/agents"),
    // "seo": () => import("@/lib/ops/engines/seo/agents"),
    // "dtc": () => import("@/lib/ops/engines/dtc/agents"),
    // "supply-chain": () => import("@/lib/ops/engines/supply-chain/agents"),
    // "revenue-intel": () => import("@/lib/ops/engines/revenue-intel/agents"),
    // "finops": () => import("@/lib/ops/engines/finops/agents"),
  };

  const loader = engineMap[engineId];
  if (!loader) {
    // Engine not yet extracted — return a stub that explains
    return {
      runAgent: async (agentKey: string) => ({
        status: "skipped",
        summary: `Engine "${engineId}" agent "${agentKey}" not yet extracted to cloud module. Still running via laptop cron.`,
      }),
    };
  }

  return loader();
}
