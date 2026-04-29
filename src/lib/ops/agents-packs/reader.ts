/**
 * Agent Packs reader — server-side helper that builds the dashboard
 * view data from the static registry + injected runtime probes.
 *
 * Implements P0-2 from `/contracts/agent-architecture-audit.md`.
 *
 * **Read-only.** No writes, no Slack posts, no contract edits, no QBO
 * / HubSpot / Shopify mutations. The page that consumes this calls
 * `buildPacksView()` once per request.
 *
 * Dependency injection model:
 *   - `engineRegistry` — defaults to importing `ENGINE_REGISTRY` from
 *     the (deprecated) engine-schedule stub. Tests override.
 *   - `engineRunnerStatus` — defaults to calling `runAgent()` once and
 *     reading the `status` field. Tests override.
 *   - `driftLoader` — defaults to running the drift detector with the
 *     factory-backed operating-memory store + a contract loader.
 *     Tests override with a fixture.
 *
 * No I/O at module-load time — every probe is awaited inside
 * `buildPacksView()` so call-sites can swap mocks.
 */

import {
  AGENT_REGISTRY,
  PACK_REGISTRY,
  type AgentEntry,
  type PackDef,
  type PackId,
} from "./registry";
import type { DriftReport } from "@/lib/ops/operating-memory/drift-types";
import {
  ACTION_REGISTRY,
  classify as classifyTaxonomy,
} from "@/lib/ops/control-plane/taxonomy";
import type {
  LockstepReport,
  LockstepSummary,
  LockstepSummaryError,
} from "@/lib/ops/contract-lockstep/types";
import { summarizeReport as summarizeLockstepReport } from "@/lib/ops/contract-lockstep/lockstep-auditor";

// =========================================================================
// View shape — what the page receives
// =========================================================================

export interface AgentEntryView extends AgentEntry {
  /**
   * Extra UI-only field: every approval slug resolved against
   * taxonomy.ts. If a slug doesn't resolve, `unknown: true` flags it
   * so the dashboard can surface the violation. Tests use this to
   * assert "every slug in registry resolves".
   */
  resolvedSlugs: ReadonlyArray<{
    slug: string;
    class: "A" | "B" | "C" | "D" | "unknown";
    name?: string;
  }>;
}

export interface PackView {
  pack: PackDef;
  agents: AgentEntryView[];
  /** Lifecycle counts within the pack. */
  counts: {
    live: number;
    partial: number;
    latent: number;
    blocked: number;
    disabled: number;
  };
}

export interface GhostRegistryWarning {
  /** True iff `engine-schedule.ts` is empty AND `engine-runner.ts` reports disabled. */
  triggered: boolean;
  /** Number of entries in the legacy engine registry (should be 0). */
  engineRegistrySize: number;
  /** Status string returned by `runAgent()` (should be "disabled"). */
  engineRunnerStatus: string;
  /**
   * Human-readable explanation. Pinned text — operators see this on
   * every dashboard load until either the warning legitimately clears
   * (e.g. someone resurrected the legacy registry — bad) OR the
   * warning is dismissed by code.
   */
  message: string;
}

export interface P0Status {
  id: "P0-1" | "P0-2" | "P0-3" | "P0-4" | "P0-5" | "P0-6" | "P0-7";
  title: string;
  state: "implemented" | "in-progress" | "blocked" | "queued";
  note?: string;
}

export interface DriftSummary {
  ok: true;
  generatedAt: string;
  scanned: number;
  total: number;
  bySeverity: DriftReport["bySeverity"];
  byDetector: DriftReport["byDetector"];
}

export interface DriftSummaryError {
  ok: false;
  error: string;
}

export interface PacksView {
  generatedAt: string;
  packs: PackView[];
  ghostWarning: GhostRegistryWarning;
  p0Status: readonly P0Status[];
  drift: DriftSummary | DriftSummaryError;
  /**
   * Lockstep summary from P0-7 (Notion ↔ /contracts auditor). Optional:
   * when no `lockstepLoader` is provided to `buildPacksView()`, this
   * is `null` (NOT a fake green badge — read-only honesty about
   * uncertainty).
   */
  lockstep: LockstepSummary | LockstepSummaryError | null;
  /**
   * Top-level invariants the page asserts. Surfaced so the UI can
   * render a small "discipline badge" — green if all green, otherwise
   * a warning card the operator can click into.
   */
  invariants: {
    drewOwnsNothing: boolean;
    allSlugsResolve: boolean;
    noNewDivisions: boolean;
    noNewSlugs: boolean;
  };
}

// =========================================================================
// Slug resolution
// =========================================================================

function resolveSlug(slug: string): AgentEntryView["resolvedSlugs"][number] {
  const spec = classifyTaxonomy(slug);
  if (!spec) return { slug, class: "unknown" };
  return { slug, class: spec.class, name: spec.name };
}

function resolveAllSlugs(agent: AgentEntry): AgentEntryView {
  return {
    ...agent,
    resolvedSlugs: agent.approvalSlugs.map(resolveSlug),
  };
}

// =========================================================================
// Lifecycle tally
// =========================================================================

function countLifecycle(agents: AgentEntry[]): PackView["counts"] {
  const counts: PackView["counts"] = {
    live: 0,
    partial: 0,
    latent: 0,
    blocked: 0,
    disabled: 0,
  };
  for (const a of agents) counts[a.lifecycle] += 1;
  return counts;
}

// =========================================================================
// Ghost-registry probe
// =========================================================================

export interface GhostRegistryProbe {
  /** Returns the legacy ENGINE_REGISTRY array (or a stand-in for tests). */
  engineRegistry: () => Promise<unknown[]> | unknown[];
  /** Returns the legacy runAgent() status (or a stand-in for tests). */
  engineRunnerStatus: () => Promise<string> | string;
}

async function defaultEngineRegistry(): Promise<unknown[]> {
  // Lazy import keeps the registry stub out of test fixture paths.
  // The deprecated stub returns `[]` — confirmed in
  // src/lib/ops/engine-schedule.ts.
  const mod = await import("@/lib/ops/engine-schedule");
  return mod.ENGINE_REGISTRY ?? [];
}

async function defaultEngineRunnerStatus(): Promise<string> {
  const mod = await import("@/lib/ops/engine-runner");
  try {
    const result = await mod.runAgent();
    if (result && typeof result === "object" && "status" in result) {
      return String((result as { status: unknown }).status);
    }
    return "unknown";
  } catch (err) {
    return err instanceof Error ? `error:${err.message}` : "error:unknown";
  }
}

async function probeGhostRegistry(
  probe?: Partial<GhostRegistryProbe>,
): Promise<GhostRegistryWarning> {
  const engineRegistry = probe?.engineRegistry ?? defaultEngineRegistry;
  const engineRunnerStatus =
    probe?.engineRunnerStatus ?? defaultEngineRunnerStatus;

  const reg = await Promise.resolve(engineRegistry());
  const status = await Promise.resolve(engineRunnerStatus());

  const triggered = reg.length === 0 && status === "disabled";
  return {
    triggered,
    engineRegistrySize: reg.length,
    engineRunnerStatus: status,
    message: triggered
      ? "Legacy 70-agent engine-schedule.ts is empty AND engine-runner.ts is disabled. " +
        "This is the EXPECTED post-3.0 state — runtime is contract-driven, not registry-driven. " +
        "Do NOT resurrect the legacy registry. See /contracts/agent-architecture-audit.md §3 for canonical inventory."
      : reg.length > 0
        ? `Legacy engine-schedule.ts has ${reg.length} entries — this is a regression. The 70-agent registry is retired; new agents register as contracts in /contracts/agents/. See /contracts/agent-architecture-audit.md §1.`
        : `engine-runner.ts status is "${status}" (expected "disabled" post-retirement). Verify nothing is calling the legacy runner.`,
  };
}

// =========================================================================
// P0 status — sourced from agent-architecture-audit.md §10
// =========================================================================

/**
 * Static mirror of the P0 build status. Hand-maintained alongside the
 * audit doc — tests assert this stays in sync with the registered
 * agents (P0-1 + P0-3 are present in `AGENT_REGISTRY`; P0-2 is this
 * dashboard itself; P0-4..P0-7 are queued).
 */
const P0_STATUS_TABLE: readonly P0Status[] = Object.freeze([
  {
    id: "P0-1",
    title: "Slack-Corrections Drift Detector",
    state: "implemented",
    note: "Shipped 2026-04-29 (slack-corrections-drift-detector in registry).",
  },
  {
    id: "P0-2",
    title: "/ops/agents/packs Dashboard",
    state: "implemented",
    note: "This dashboard. Read-only. Class A renderer.",
  },
  {
    id: "P0-3",
    title: "Operating-Memory Transcript Saver",
    state: "implemented",
    note: "Shipped 2026-04-28 (transcript-saver in registry).",
  },
  {
    id: "P0-4",
    title: "Vendor-Master Coordinator",
    state: "implemented",
    note:
      "Shipped 2026-04-29. Coordinator at src/lib/ops/vendor-master/coordinator.ts validates required fields, dedupes via existing registry, and delegates to the canonical openVendorOnboardingApproval (Class B vendor.master.create / Rene). Pure DI; no QBO/Notion/Drive write before approval.",
  },
  {
    id: "P0-5",
    title: "Approval-Expiry Sweeper",
    state: "implemented",
    note:
      "Shipped 2026-04-29. Pure functions checkExpiry/shouldEscalate already in approvals.ts; sweeper at src/lib/ops/sweeps/approval-expiry.ts; route /api/ops/control-plane/approval-sweep (hourly cron); fail-closed on unknown action slugs.",
  },
  {
    id: "P0-6",
    title: "Receipt-OCR → Bill-Draft Promoter",
    state: "implemented",
    note:
      "Shipped 2026-04-29. Pure DI promoter at src/lib/ops/receipts/bill-draft-promoter.ts bridges rene-approved review packets → qbo.bill.create Class B / Rene approval. OCR is suggestion only; canonical fields never overwritten. Vendor resolution routes to P0-4 vendor-master coordinator on miss.",
  },
  {
    id: "P0-7",
    title: "Notion ↔ /contracts Lockstep Auditor",
    state: "implemented",
    note:
      "Shipped 2026-04-29. Pure DI auditor in src/lib/ops/contract-lockstep/; 8 detectors; degraded-mode when Notion manifest unavailable. No Notion writes — observation-only.",
  },
]);

// =========================================================================
// Drift summary loader
// =========================================================================

export type DriftLoader = () => Promise<DriftReport>;

async function loadDriftSummary(
  loader?: DriftLoader,
): Promise<DriftSummary | DriftSummaryError> {
  if (!loader) {
    return { ok: false, error: "no drift loader provided" };
  }
  try {
    const report = await loader();
    return {
      ok: true,
      generatedAt: report.generatedAt,
      scanned: report.scanned,
      total: report.findings.length,
      bySeverity: report.bySeverity,
      byDetector: report.byDetector,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown drift load error",
    };
  }
}

// =========================================================================
// Invariant probes
// =========================================================================

function checkInvariants(agents: AgentEntryView[]): PacksView["invariants"] {
  const drewOwnsNothing = !agents.some((a) => a.humanOwner === "Drew");
  const allSlugsResolve = agents.every((a) =>
    a.resolvedSlugs.every((s) => s.class !== "unknown"),
  );
  // No new divisions — every agent's division is in the registered set.
  const allowedDivisions = new Set([
    "executive-control",
    "sales",
    "financials",
    "production-supply-chain",
    "research-intelligence",
    "platform-data-automation",
    "marketing-brand",
    "marketing-paid",
    "trade-shows-field",
    "outreach-partnerships-press",
    "customer-experience",
    "product-packaging-rd",
  ]);
  const noNewDivisions = agents.every((a) => allowedDivisions.has(a.division));
  // No new slugs — every slug in the registry is in ACTION_REGISTRY.
  const registeredSlugSet = new Set(ACTION_REGISTRY.map((a) => a.slug));
  const noNewSlugs = agents.every((a) =>
    a.approvalSlugs.every((s) => registeredSlugSet.has(s)),
  );
  return { drewOwnsNothing, allSlugsResolve, noNewDivisions, noNewSlugs };
}

// =========================================================================
// Public API — buildPacksView
// =========================================================================

export type LockstepLoader = () => Promise<LockstepReport>;

export interface BuildPacksViewDeps {
  /** Optional ghost-registry probe override for tests. */
  ghostProbe?: Partial<GhostRegistryProbe>;
  /** Optional drift loader override for tests. */
  driftLoader?: DriftLoader;
  /**
   * Optional lockstep auditor loader. When omitted, `lockstep` is null
   * — the dashboard renders an "auditor inactive" card explicit about
   * the uncertainty. Tests pass a fixture loader to assert wiring.
   */
  lockstepLoader?: LockstepLoader;
  /** Clock injection. Defaults to `() => new Date()`. */
  now?: () => Date;
}

async function loadLockstepSummary(
  loader: LockstepLoader | undefined,
): Promise<LockstepSummary | LockstepSummaryError | null> {
  if (!loader) return null;
  try {
    const report = await loader();
    return { ok: true, ...summarizeLockstepReport(report) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown lockstep load error",
    };
  }
}

export async function buildPacksView(
  deps: BuildPacksViewDeps = {},
): Promise<PacksView> {
  const now = (deps.now ?? (() => new Date()))();

  // Resolve slugs once; reuse across packs.
  const resolvedAgents = AGENT_REGISTRY.map(resolveAllSlugs);
  const byId = new Map<string, AgentEntryView>(resolvedAgents.map((a) => [a.id, a]));

  const packs: PackView[] = PACK_REGISTRY.map((pack) => {
    const members = pack.memberIds
      .map((id) => byId.get(id))
      .filter((a): a is AgentEntryView => a !== undefined);
    return {
      pack,
      agents: members,
      counts: countLifecycle(members),
    };
  });

  const ghostWarning = await probeGhostRegistry(deps.ghostProbe);
  const drift = await loadDriftSummary(deps.driftLoader);
  const lockstep = await loadLockstepSummary(deps.lockstepLoader);
  const invariants = checkInvariants(resolvedAgents);

  return {
    generatedAt: now.toISOString(),
    packs,
    ghostWarning,
    p0Status: P0_STATUS_TABLE,
    drift,
    lockstep,
    invariants,
  };
}

/** Exposed for tests. */
export const __INTERNAL = {
  resolveSlug,
  resolveAllSlugs,
  countLifecycle,
  checkInvariants,
  P0_STATUS_TABLE,
  probeGhostRegistry,
};

export type { PackId };
