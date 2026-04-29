/**
 * GET /api/ops/operating-memory/drift
 *
 * Read-only Class A endpoint exposing the Slack-Corrections Drift
 * Detector report (P0-1 from `/contracts/agent-architecture-audit.md`).
 *
 * Auth: bearer CRON_SECRET via `isCronAuthorized()`. Same pattern as
 * `/api/ops/transcript/capture` (P0-3).
 *
 * Side effects: NONE. The detector reads the operating-memory store +
 * contract files; it never writes. The route does not append to the
 * audit store either — observation-only.
 *
 * Query params:
 *   - `windowDays` (number, default 14, clamped [1, 60])
 *   - `maxScan`    (number, default 2000, hard cap 2000)
 *   - `severity`   (filter: low|medium|high|critical, comma-separated)
 *   - `detector`   (filter: drew-regression|class-d-request|unknown-slug|
 *                   doctrine-contradiction|stale-reference, comma-separated)
 *
 * Filters apply AFTER detector run, so the `byDetector` / `bySeverity`
 * tallies always reflect the unfiltered scan; the returned `findings`
 * array is the filtered subset.
 */

import { NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";

import {
  isCronAuthorized,
  unauthorized,
} from "@/lib/ops/control-plane/admin-auth";

import { runDriftDetection } from "@/lib/ops/operating-memory/drift-detector";
import type {
  ContractSource,
  DriftDetectorKind,
  DriftSeverity,
} from "@/lib/ops/operating-memory/drift-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Canonical contract paths the detector cross-references. New contracts
 * added to this list become "known" for the stale-reference detector.
 *
 * Paths are repo-relative; the loader resolves them against process.cwd().
 */
const CONTRACT_PATHS: readonly string[] = Object.freeze([
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
  "contracts/divisions.json",
  "contracts/channels.json",
  "contracts/agent-architecture-audit.md",
  "contracts/agents/booke.md",
  "contracts/agents/compliance-specialist.md",
  "contracts/agents/drift-audit-runner.md",
  "contracts/agents/executive-brief.md",
  "contracts/agents/faire-specialist.md",
  "contracts/agents/finance-exception.md",
  "contracts/agents/interviewer.md",
  "contracts/agents/inventory-specialist.md",
  "contracts/agents/ops.md",
  "contracts/agents/platform-specialist.md",
  "contracts/agents/r1-consumer.md",
  "contracts/agents/r2-market.md",
  "contracts/agents/r3-competitive.md",
  "contracts/agents/r4-channel.md",
  "contracts/agents/r5-regulatory.md",
  "contracts/agents/r6-supply.md",
  "contracts/agents/r7-press.md",
  "contracts/agents/reconciliation-specialist.md",
  "contracts/agents/research-librarian.md",
  "contracts/agents/sample-order-dispatch.md",
  "contracts/agents/viktor-rene-capture.md",
  "ops/LIVE-RUNWAY-2026-04-25.md",
]);

async function loadContracts(): Promise<readonly ContractSource[]> {
  const root = process.cwd();
  const out: ContractSource[] = [];
  await Promise.all(
    CONTRACT_PATHS.map(async (rel) => {
      try {
        const abs = path.resolve(root, rel);
        const text = await fs.readFile(abs, "utf8");
        out.push({ path: rel, text });
      } catch {
        // Missing file = the stale-reference detector handles it
        // gracefully (path not in known set → finding emitted). We do
        // not surface load errors as 500s.
      }
    }),
  );
  return out;
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseEnumList<T extends string>(
  raw: string | null,
  allowed: readonly T[],
): T[] | undefined {
  if (!raw) return undefined;
  const set = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  const allowedSet = new Set<string>(allowed);
  const out: T[] = [];
  for (const v of set) {
    if (allowedSet.has(v)) out.push(v as T);
  }
  return out.length > 0 ? out : undefined;
}

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  const url = new URL(req.url);
  const windowDays = clampInt(url.searchParams.get("windowDays"), 14, 1, 60);
  const maxScan = clampInt(url.searchParams.get("maxScan"), 2000, 1, 2000);

  const severityFilter = parseEnumList<DriftSeverity>(
    url.searchParams.get("severity"),
    ["low", "medium", "high", "critical"],
  );
  const detectorFilter = parseEnumList<DriftDetectorKind>(
    url.searchParams.get("detector"),
    [
      "drew-regression",
      "class-d-request",
      "unknown-slug",
      "doctrine-contradiction",
      "stale-reference",
    ],
  );

  try {
    const report = await runDriftDetection({
      loadContracts,
      windowDays,
      maxScan,
    });

    let findings = report.findings;
    if (severityFilter) {
      const set = new Set(severityFilter);
      findings = findings.filter((f) => set.has(f.severity));
    }
    if (detectorFilter) {
      const set = new Set(detectorFilter);
      findings = findings.filter((f) => set.has(f.detector));
    }

    return NextResponse.json({ ...report, findings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
