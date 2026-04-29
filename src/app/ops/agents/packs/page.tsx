/**
 * /ops/agents/packs — P0-2 from /contracts/agent-architecture-audit.md.
 *
 * Read-only Class A renderer. The page is a server component that
 * builds its data in-process via `buildPacksView()` — no client
 * self-fetch, no API hop, no writes.
 *
 * What this page is:
 *   - 6 dashboard packs grouping the 21+ agent contracts by audience.
 *   - A ghost-registry warning surfacing the legacy 70-agent state.
 *   - The P0 build status mirrored from the audit doc.
 *   - The latest drift summary from P0-1 (called server-side).
 *
 * What this page is NOT:
 *   - A new approval slug. (No `slug.create` here.)
 *   - A new division. (No new entry in divisions.json.)
 *   - A resurrection of `engine-schedule.ts`. (That stub stays empty.)
 *   - An editor. (Read-only — no buttons that mutate state.)
 *
 * Drew-owns-nothing: The reader's `invariants.drewOwnsNothing` check
 * fires red if any `humanOwner` resolves to "Drew". Today no agent
 * does — Sample/Order Dispatch routes Drew as a fulfillment node, but
 * the contract's owner is Ben.
 */
import type { Metadata } from "next";
import Link from "next/link";
import path from "node:path";
import { promises as fs } from "node:fs";

import {
  buildPacksView,
  type AgentEntryView,
  type GhostRegistryWarning,
  type P0Status,
  type PackView,
  type PacksView,
} from "@/lib/ops/agents-packs/reader";
import { runDriftDetection } from "@/lib/ops/operating-memory/drift-detector";
import type { ContractSource } from "@/lib/ops/operating-memory/drift-types";
import {
  auditLockstep,
} from "@/lib/ops/contract-lockstep/lockstep-auditor";
import { readRepoManifest } from "@/lib/ops/contract-lockstep/repo-manifest";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Agent packs",
};

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

/**
 * Default lockstep loader for this route. Reads the repo manifest from
 * disk and audits with `notionManifest = null` — degraded mode. The
 * auditor still flags repo-side issues (Drew regression, unknown slugs,
 * doctrine markers) even without Notion. To enable full cross-walk,
 * inject a Notion-fetching loader that supplies the manifest.
 */
async function loadLockstepReport() {
  const repoManifest = await readRepoManifest();
  return auditLockstep({
    repoManifest,
    notionManifest: null, // live Notion fetch not wired into this route
  });
}

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

export default async function OpsAgentPacksPage() {
  let view: PacksView | null = null;
  let loadError: string | null = null;
  try {
    view = await buildPacksView({
      driftLoader: loadDriftReport,
      lockstepLoader: loadLockstepReport,
    });
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  if (!view || loadError) {
    return (
      <div className="mx-auto max-w-[1200px] p-6">
        <h1 className="text-2xl font-bold">Agent packs</h1>
        <div className="mt-4 border-2 border-red-500 bg-red-50 p-3 text-sm text-red-900">
          Failed to build packs view: {loadError ?? "no view"}
        </div>
      </div>
    );
  }

  const totalAgents = view.packs.reduce((acc, p) => acc + p.agents.length, 0);
  const totalLive = view.packs.reduce((acc, p) => acc + p.counts.live, 0);
  const totalLatent = view.packs.reduce((acc, p) => acc + p.counts.latent, 0);
  const totalPartial = view.packs.reduce((acc, p) => acc + p.counts.partial, 0);

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Agent packs</h1>
        <div className="text-sm text-gray-600">
          {view.packs.length} packs · {totalAgents} agents · {totalLive} live ·{" "}
          {totalPartial} partial · {totalLatent} latent
        </div>
      </header>

      <p className="mb-4 text-sm text-gray-600">
        Read-only dashboard cross-cut over{" "}
        <Link href="https://github.com/" className="underline">
          /contracts/agents/
        </Link>{" "}
        + viktor.md. Packs are audience-shaped read-models — they do NOT add
        agents, divisions, or approval slugs. See{" "}
        <span className="font-mono text-xs">contracts/agent-architecture-audit.md</span>{" "}
        §4 for doctrine.
      </p>

      <InvariantsBadge invariants={view.invariants} />

      <GhostRegistrySection ghost={view.ghostWarning} />

      <P0StatusSection p0Status={view.p0Status} />

      <DriftSection drift={view.drift} />

      <LockstepSection lockstep={view.lockstep} />

      <section className="mt-8">
        <h2 className="mb-3 text-xl font-bold">Packs</h2>
        <div className="grid gap-4">
          {view.packs.map((pv) => (
            <PackCard key={pv.pack.id} pv={pv} />
          ))}
        </div>
      </section>

      <footer className="mt-8 text-xs text-gray-500">
        <p>
          Generated at{" "}
          <span className="font-mono">{view.generatedAt}</span>. Source of truth:
          static <span className="font-mono">AGENT_REGISTRY</span> in{" "}
          <span className="font-mono">src/lib/ops/agents-packs/registry.ts</span>{" "}
          mirrored from the contract files. The legacy{" "}
          <span className="font-mono">engine-schedule.ts</span> /{" "}
          <span className="font-mono">engine-runner.ts</span> are intentionally
          empty stubs and should remain so.
        </p>
      </footer>
    </div>
  );
}

// =========================================================================
// Section: invariants badge
// =========================================================================

function InvariantsBadge({ invariants }: { invariants: PacksView["invariants"] }) {
  const allGreen =
    invariants.drewOwnsNothing &&
    invariants.allSlugsResolve &&
    invariants.noNewDivisions &&
    invariants.noNewSlugs;
  return (
    <div
      className={`mb-4 rounded border-2 p-3 text-sm ${
        allGreen ? "border-green-700 bg-green-50 text-green-900" : "border-red-500 bg-red-50 text-red-900"
      }`}
    >
      <div className="font-bold">
        {allGreen ? "✓ Discipline invariants green" : "⚠ Discipline invariant violation"}
      </div>
      <ul className="mt-1 ml-4 list-disc text-xs">
        <li>Drew owns nothing: {invariants.drewOwnsNothing ? "✓" : "✗"}</li>
        <li>All approval slugs resolve to taxonomy.ts: {invariants.allSlugsResolve ? "✓" : "✗"}</li>
        <li>No new divisions introduced: {invariants.noNewDivisions ? "✓" : "✗"}</li>
        <li>No new approval slugs introduced: {invariants.noNewSlugs ? "✓" : "✗"}</li>
      </ul>
    </div>
  );
}

// =========================================================================
// Section: ghost-registry warning
// =========================================================================

function GhostRegistrySection({ ghost }: { ghost: GhostRegistryWarning }) {
  const color = ghost.triggered
    ? "border-yellow-600 bg-yellow-50 text-yellow-900"
    : "border-red-600 bg-red-50 text-red-900";
  return (
    <div className={`mb-4 rounded border-2 p-3 text-sm ${color}`}>
      <div className="font-bold">
        {ghost.triggered ? "ℹ Legacy 70-agent registry retired (expected)" : "⚠ Legacy registry state regression"}
      </div>
      <p className="mt-1 text-xs">{ghost.message}</p>
      <div className="mt-1 text-xs">
        <span className="font-mono">engineRegistry.length = {ghost.engineRegistrySize}</span>{" "}
        ·{" "}
        <span className="font-mono">engineRunner.status = {ghost.engineRunnerStatus}</span>
      </div>
    </div>
  );
}

// =========================================================================
// Section: P0 status
// =========================================================================

function P0StatusSection({ p0Status }: { p0Status: readonly P0Status[] }) {
  const stateColor = (s: P0Status["state"]): string => {
    switch (s) {
      case "implemented":
        return "bg-green-100 text-green-900 border-green-700";
      case "in-progress":
        return "bg-yellow-100 text-yellow-900 border-yellow-700";
      case "blocked":
        return "bg-red-100 text-red-900 border-red-700";
      case "queued":
      default:
        return "bg-gray-100 text-gray-900 border-gray-400";
    }
  };
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xl font-bold">P0 build status</h2>
      <p className="mb-2 text-xs text-gray-600">
        Mirrored from{" "}
        <span className="font-mono">contracts/agent-architecture-audit.md</span>{" "}
        §10. This table does NOT mutate the audit doc.
      </p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-gray-900 bg-gray-50 text-left">
            <th className="p-2">ID</th>
            <th className="p-2">Title</th>
            <th className="p-2">State</th>
            <th className="p-2">Note</th>
          </tr>
        </thead>
        <tbody>
          {p0Status.map((p) => (
            <tr key={p.id} className="border-b border-gray-200">
              <td className="p-2 font-mono text-xs">{p.id}</td>
              <td className="p-2">{p.title}</td>
              <td className="p-2">
                <span
                  className={`inline-block rounded border px-2 py-0.5 text-xs font-bold ${stateColor(p.state)}`}
                >
                  {p.state}
                </span>
              </td>
              <td className="p-2 text-xs text-gray-700">{p.note ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// =========================================================================
// Section: drift summary
// =========================================================================

function DriftSection({ drift }: { drift: PacksView["drift"] }) {
  if (!drift.ok) {
    return (
      <div className="mt-6 rounded border-2 border-yellow-600 bg-yellow-50 p-3 text-sm text-yellow-900">
        <div className="font-bold">Drift summary unavailable</div>
        <p className="mt-1 text-xs">{drift.error}</p>
      </div>
    );
  }
  return (
    <section className="mt-6 rounded border border-gray-300 p-3">
      <h2 className="text-xl font-bold">Drift summary (last 14d)</h2>
      <p className="mt-1 text-xs text-gray-600">
        From <span className="font-mono">runDriftDetection()</span> at{" "}
        <span className="font-mono">{drift.generatedAt}</span>.{" "}
        {drift.scanned} entries scanned, {drift.total} findings.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
        <DriftCount label="Critical" value={drift.bySeverity.critical} color="text-red-700" />
        <DriftCount label="High" value={drift.bySeverity.high} color="text-orange-700" />
        <DriftCount label="Medium" value={drift.bySeverity.medium} color="text-yellow-700" />
        <DriftCount label="Low" value={drift.bySeverity.low} color="text-gray-700" />
      </div>
      <div className="mt-3 text-xs text-gray-600">
        Detectors:{" "}
        {Object.entries(drift.byDetector).map(([k, v]) => (
          <span key={k} className="mr-3">
            <span className="font-mono">{k}</span>={v}
          </span>
        ))}
      </div>
      <div className="mt-2 text-xs text-gray-500">
        Full report:{" "}
        <Link
          href="/api/ops/operating-memory/drift"
          className="font-mono underline"
        >
          GET /api/ops/operating-memory/drift
        </Link>{" "}
        (bearer CRON_SECRET)
      </div>
    </section>
  );
}

function DriftCount({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded border border-gray-200 p-2 text-center">
      <div className="text-xs text-gray-600">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

// =========================================================================
// Section: lockstep summary (P0-7)
// =========================================================================

function LockstepSection({ lockstep }: { lockstep: PacksView["lockstep"] }) {
  if (!lockstep) {
    return (
      <section className="mt-6 rounded border border-gray-300 p-3">
        <h2 className="text-xl font-bold">Lockstep summary (Notion ↔ /contracts)</h2>
        <p className="mt-1 text-xs text-gray-500">
          Loader not wired in this build. The lockstep auditor is implemented
          (P0-7) but no caller is supplying it on this page.
        </p>
      </section>
    );
  }
  if (!lockstep.ok) {
    return (
      <div className="mt-6 rounded border-2 border-yellow-600 bg-yellow-50 p-3 text-sm text-yellow-900">
        <div className="font-bold">Lockstep summary unavailable</div>
        <p className="mt-1 text-xs">{lockstep.error}</p>
      </div>
    );
  }
  const degraded = !lockstep.fullyAudited;
  return (
    <section
      className={`mt-6 rounded border p-3 ${degraded ? "border-yellow-500 bg-yellow-50" : "border-gray-300"}`}
    >
      <h2 className="text-xl font-bold">
        Lockstep summary{degraded ? " (degraded)" : ""}
      </h2>
      <p className="mt-1 text-xs text-gray-600">
        Notion ↔ /contracts auditor (P0-7) — observation-only, never writes to
        Notion or contract files. Generated{" "}
        <span className="font-mono">{lockstep.generatedAt}</span>.{" "}
        {lockstep.repoCount} repo contracts · {lockstep.notionCount} Notion
        canon items · {lockstep.totalFindings} findings.
      </p>
      {degraded ? (
        <div className="mt-2 rounded border border-yellow-400 bg-yellow-100 p-2 text-xs text-yellow-900">
          <div className="font-bold">Degraded mode — explicit about uncertainty:</div>
          <ul className="ml-4 mt-1 list-disc">
            {lockstep.degradedReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
        <DriftCount label="Critical" value={lockstep.bySeverity.critical} color="text-red-700" />
        <DriftCount label="High" value={lockstep.bySeverity.high} color="text-orange-700" />
        <DriftCount label="Medium" value={lockstep.bySeverity.medium} color="text-yellow-700" />
        <DriftCount label="Low" value={lockstep.bySeverity.low} color="text-gray-700" />
      </div>
      <div className="mt-2 text-xs text-gray-600">
        Detectors:{" "}
        {Object.entries(lockstep.byDetector).map(([k, v]) => (
          <span key={k} className="mr-3">
            <span className="font-mono">{k}</span>={v}
          </span>
        ))}
      </div>
    </section>
  );
}

// =========================================================================
// Section: pack card
// =========================================================================

function PackCard({ pv }: { pv: PackView }) {
  return (
    <div className="rounded border border-gray-300 p-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h3 className="text-lg font-bold">{pv.pack.name}</h3>
          <div className="text-xs text-gray-500">
            audience: {pv.pack.audience} · owner: {pv.pack.primaryOwner}
          </div>
        </div>
        <div className="text-xs text-gray-600">
          {pv.counts.live} live · {pv.counts.partial} partial ·{" "}
          {pv.counts.latent} latent
          {pv.counts.disabled > 0 ? ` · ${pv.counts.disabled} disabled` : null}
        </div>
      </div>
      <p className="mt-1 text-sm text-gray-700">{pv.pack.description}</p>
      <div className="mt-3 grid gap-2">
        {pv.agents.map((a) => (
          <AgentRow key={a.id} agent={a} />
        ))}
      </div>
    </div>
  );
}

function AgentRow({ agent }: { agent: AgentEntryView }) {
  const lifecycleColor: Record<typeof agent.lifecycle, string> = {
    live: "bg-green-100 text-green-900 border-green-700",
    partial: "bg-yellow-100 text-yellow-900 border-yellow-700",
    latent: "bg-gray-100 text-gray-700 border-gray-400",
    blocked: "bg-red-100 text-red-900 border-red-700",
    disabled: "bg-red-200 text-red-900 border-red-800",
  };
  const unknownSlugs = agent.resolvedSlugs.filter((s) => s.class === "unknown");
  return (
    <div className="rounded border border-gray-200 bg-white p-2 text-sm">
      <div className="flex items-baseline justify-between">
        <div className="font-medium">{agent.name}</div>
        <span
          className={`inline-block rounded border px-2 py-0.5 text-xs font-bold ${lifecycleColor[agent.lifecycle]}`}
        >
          {agent.lifecycle}
        </span>
      </div>
      <div className="mt-1 text-xs text-gray-600">
        <span className="font-mono">{agent.division}</span> · owner:{" "}
        {agent.humanOwner}
        {agent.channel ? (
          <>
            {" · "}
            channel: <span className="font-mono">{agent.channel}</span>
          </>
        ) : null}
      </div>
      <div className="mt-1 text-xs text-gray-700">{agent.role}</div>
      {agent.blocker ? (
        <div className="mt-1 rounded border border-yellow-400 bg-yellow-50 p-1 text-xs text-yellow-900">
          blocker: {agent.blocker}
        </div>
      ) : null}
      <div className="mt-1 text-xs">
        contract:{" "}
        <span className="font-mono">{agent.contractPath}</span>
        {agent.runtimePath ? (
          <>
            {" · "}
            runtime: <span className="font-mono">{agent.runtimePath}</span>
          </>
        ) : (
          <>
            {" · "}
            <span className="text-gray-500">runtime: not wired</span>
          </>
        )}
      </div>
      {agent.approvalSlugs.length > 0 ? (
        <div className="mt-1 text-xs">
          slugs:{" "}
          {agent.resolvedSlugs.map((s) => (
            <span
              key={s.slug}
              className={`mr-1 inline-block rounded border px-1 font-mono text-[11px] ${
                s.class === "unknown"
                  ? "border-red-500 bg-red-50 text-red-900"
                  : s.class === "D"
                    ? "border-red-500 bg-red-50 text-red-900"
                    : s.class === "C"
                      ? "border-orange-500 bg-orange-50 text-orange-900"
                      : s.class === "B"
                        ? "border-blue-500 bg-blue-50 text-blue-900"
                        : "border-gray-300 bg-gray-50 text-gray-700"
              }`}
            >
              {s.slug}
              <span className="ml-1 text-[10px]">[{s.class}]</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-1 text-xs text-gray-500">
          no approval slugs (observation-only / pre-build)
        </div>
      )}
      {unknownSlugs.length > 0 ? (
        <div className="mt-1 rounded border border-red-500 bg-red-50 p-1 text-xs text-red-900">
          ⚠ unresolved slug(s): {unknownSlugs.map((s) => s.slug).join(", ")} —
          register in contracts/approval-taxonomy.md.
        </div>
      ) : null}
    </div>
  );
}
