/**
 * GET /api/ops/agents/packs/snapshot
 *
 * Read-only JSON backing route for the OpenAI MCP workspace connector
 * tool `ops.agent.packs` (Codex's Phase 0 registry). Mirrors the page
 * data the `/ops/agents/packs` server component renders, but as JSON
 * so ChatGPT custom connectors can consume it via Codex's
 * loadLiveReadModel() shim.
 *
 * Auth: bearer CRON_SECRET (same convention as drift/transcript routes;
 * Codex's MCP connector route passes CRON_SECRET on every backing fetch).
 *
 * Hard rules:
 *   - Read-only. No writes. Class A.
 *   - Calls buildPacksView() which is itself read-only.
 *   - Drift loader passes notionManifest=null (degraded mode honest)
 *     and lockstepLoader uses the read-only repo manifest reader.
 *   - The drift detector + lockstep auditor are both observation-only
 *     per their P0-1 / P0-7 contracts.
 *   - No new approval slug, no new division.
 */

import { NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";

import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import { buildPacksView } from "@/lib/ops/agents-packs/reader";
import { runDriftDetection } from "@/lib/ops/operating-memory/drift-detector";
import type { ContractSource } from "@/lib/ops/operating-memory/drift-types";
import { auditLockstep } from "@/lib/ops/contract-lockstep/lockstep-auditor";
import { readRepoManifest } from "@/lib/ops/contract-lockstep/repo-manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Contracts the drift detector cross-references for stale-reference checks. */
const CONTRACT_PATHS_FOR_DRIFT: readonly string[] = Object.freeze([
  "CLAUDE.md",
  "contracts/governance.md",
  "contracts/hard-rules.md",
  "contracts/approval-taxonomy.md",
  "contracts/operating-memory.md",
  "contracts/slack-operating.md",
  "contracts/session-handoff.md",
  "contracts/wholesale-pricing.md",
  "contracts/wholesale-onboarding-flow.md",
  "contracts/viktor.md",
  "contracts/viktor-rene-briefing.md",
  "contracts/agent-architecture-audit.md",
]);

async function loadDriftReport() {
  const root = process.cwd();
  const contracts: ContractSource[] = [];
  await Promise.all(
    CONTRACT_PATHS_FOR_DRIFT.map(async (rel) => {
      try {
        const text = await fs.readFile(path.resolve(root, rel), "utf8");
        contracts.push({ path: rel, text });
      } catch {
        // missing file → drift detector handles via stale-reference
      }
    }),
  );
  return runDriftDetection({
    loadContracts: async () => contracts,
    windowDays: 14,
  });
}

async function loadLockstepReport() {
  const repoManifest = await readRepoManifest();
  return auditLockstep({
    repoManifest,
    notionManifest: null, // live Notion fetch not wired into this route
  });
}

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  try {
    const view = await buildPacksView({
      driftLoader: loadDriftReport,
      lockstepLoader: loadLockstepReport,
    });
    return NextResponse.json({ ok: true, ...view });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
