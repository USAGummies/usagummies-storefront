/**
 * POST /api/ops/abra/cron/sweep?name=<sweep-name>
 *
 * Unified sweep dispatcher. Runs any registered sweep by name.
 * All sweeps are dispatched through this single route to avoid
 * creating 15+ individual cron route files.
 *
 * Usage: POST /api/ops/abra/cron/sweep?name=bank-feed-sweep
 *        POST /api/ops/abra/cron/sweep?name=vendor-followup
 */

import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/abra-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 55;

const legacyAutonomousAbraDisabled =
  (process.env.ABRA_LEGACY_AUTONOMOUS_DISABLED || "1").trim() !== "0";

type SweepResult = {
  name: string;
  ok: boolean;
  result: unknown;
  duration: number;
  error?: string;
};

// Lazy imports to avoid loading everything on cold start
const SWEEP_REGISTRY: Record<string, () => Promise<unknown>> = {
  "bank-feed-sweep": async () => {
    const { runBankFeedSweep } = await import("@/lib/ops/sweeps/bank-feed-sweep");
    return runBankFeedSweep();
  },
  "morning-brief": async () => {
    // Morning brief is dispatched via the dedicated route
    const host = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com";
    const cs = (process.env.CRON_SECRET || "").trim();
    const res = await fetch(`${host}/api/ops/abra/morning-brief`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cs}` },
      signal: AbortSignal.timeout(50000),
    });
    return res.json();
  },
  "approval-expiry": async () => {
    const { runApprovalExpirySweep } = await import("@/lib/ops/sweeps/approval-expiry");
    return runApprovalExpirySweep();
  },
  "evening-recon": async () => {
    const { runEveningRecon } = await import("@/lib/ops/sweeps/evening-recon");
    return runEveningRecon();
  },
  "vendor-followup": async () => {
    const { runVendorFollowUpSweep } = await import("@/lib/ops/sweeps/vendor-followup");
    return runVendorFollowUpSweep();
  },
  "bank-auto-tagger": async () => {
    const { runAutoTagger } = await import("@/lib/ops/sweeps/bank-auto-tagger");
    return runAutoTagger();
  },
  "daily-pnl": async () => {
    const { postDailyPnL } = await import("@/lib/ops/daily-pnl");
    return postDailyPnL();
  },
  "triple-recon": async () => {
    const { runTripleReconciliation } = await import("@/lib/ops/sweeps/triple-recon");
    return runTripleReconciliation();
  },
  "qbo-health-sweep": async () => {
    const { runQBOHealthSweep } = await import("@/lib/ops/sweeps/qbo-health-sweep");
    return runQBOHealthSweep();
  },
  "customer-intelligence": async () => {
    const { runCustomerIntelligence } = await import("@/lib/ops/sweeps/customer-intelligence");
    return runCustomerIntelligence();
  },
  "marketing-attribution": async () => {
    const { runMarketingAttribution } = await import("@/lib/ops/sweeps/marketing-attribution");
    return runMarketingAttribution();
  },
  "knowledge-base-builder": async () => {
    const { buildKnowledgeBase } = await import("@/lib/ops/sweeps/knowledge-base-builder");
    return buildKnowledgeBase();
  },
  "competitive-monitor": async () => {
    const { runCompetitiveMonitor } = await import("@/lib/ops/sweeps/competitive-monitor");
    return runCompetitiveMonitor();
  },
  "amazon-review-ingester": async () => {
    const { ingestAmazonReviews } = await import("@/lib/ops/sweeps/amazon-review-ingester");
    return ingestAmazonReviews();
  },
};

async function handler(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (legacyAutonomousAbraDisabled) {
    return NextResponse.json({
      ok: true,
      disabled: true,
      reason: "Legacy Abra sweeps disabled; Paperclip is the active control plane.",
    });
  }

  const url = new URL(req.url);
  const sweepName = url.searchParams.get("name") || "";

  // If no name, run all registered sweeps (useful for daily catch-all)
  if (!sweepName || sweepName === "all") {
    const results: SweepResult[] = [];
    for (const [name, runner] of Object.entries(SWEEP_REGISTRY)) {
      const start = Date.now();
      try {
        const result = await runner();
        results.push({ name, ok: true, result, duration: Date.now() - start });
      } catch (err) {
        results.push({
          name,
          ok: false,
          result: null,
          duration: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const passed = results.filter(r => r.ok).length;
    return NextResponse.json({
      ok: passed === results.length,
      total: results.length,
      passed,
      failed: results.length - passed,
      results,
    });
  }

  // Single sweep
  const runner = SWEEP_REGISTRY[sweepName];
  if (!runner) {
    return NextResponse.json(
      { error: `Unknown sweep: ${sweepName}. Available: ${Object.keys(SWEEP_REGISTRY).join(", ")}` },
      { status: 400 },
    );
  }

  const start = Date.now();
  try {
    const result = await runner();
    return NextResponse.json({
      ok: true,
      name: sweepName,
      result,
      duration: Date.now() - start,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        name: sweepName,
        error: err instanceof Error ? err.message : String(err),
        duration: Date.now() - start,
      },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) { return handler(req); }
export async function POST(req: Request) { return handler(req); }
