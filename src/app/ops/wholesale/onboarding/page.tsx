/**
 * /ops/wholesale/onboarding — Phase 35.f.5.c
 *
 * Auth-gated review surface for Rene to monitor in-flight wholesale
 * onboarding flows. Reads `listRecentFlows` directly server-side
 * (no API hop — saves a round-trip + avoids CORS / auth-token shuffling).
 * Middleware enforces session-only access for /ops/* routes.
 *
 * Server component: renders a table of recent flows + a "stalled-
 * only" toggle (via query param `?stalledOnly=true`). Each row links
 * to the public-facing `/wholesale/order?flowId=X` URL the customer
 * sees so Rene can preview their state.
 */
import type { Metadata } from "next";
import Link from "next/link";

import {
  nextStep,
  type OnboardingState,
  type OnboardingStep,
} from "@/lib/wholesale/onboarding-flow";
import { listRecentFlows } from "@/lib/wholesale/onboarding-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Wholesale onboarding flows",
};

const DEFAULT_STALL_HOURS = 24;
const FLOW_LIMIT = 200;

interface SearchParams {
  stalledOnly?: string;
  stallHours?: string;
}

function mostRecentTimestamp(state: OnboardingState): string | undefined {
  const stamps = Object.values(state.timestamps).filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  if (stamps.length === 0) return undefined;
  return stamps.reduce((a, b) => (a > b ? a : b));
}

function summarize(
  state: OnboardingState,
  stallMs: number,
  now: Date,
) {
  const last = mostRecentTimestamp(state);
  const next = nextStep(state);
  const stalled =
    next !== null &&
    last !== undefined &&
    now.getTime() - new Date(last).getTime() > stallMs;
  const subtotal = state.orderLines.reduce((acc, l) => acc + l.subtotalUsd, 0);
  return {
    flowId: state.flowId,
    currentStep: state.currentStep as OnboardingStep,
    nextStep: next,
    completedCount: state.stepsCompleted.length,
    prospect: state.prospect,
    paymentPath: state.paymentPath,
    orderLineCount: state.orderLines.length,
    totalSubtotalUsd: Math.round(subtotal * 100) / 100,
    hubspotDealId: state.hubspotDealId,
    qboCustomerApprovalId: state.qboCustomerApprovalId,
    lastTimestamp: last,
    hoursSinceLastTouch: last
      ? (now.getTime() - new Date(last).getTime()) / 3_600_000
      : null,
    stalled,
  };
}

export default async function OpsWholesaleOnboardingPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const stalledOnly = params.stalledOnly === "true";
  const rawStall = Number.parseInt(
    params.stallHours ?? String(DEFAULT_STALL_HOURS),
    10,
  );
  const stallHours = Number.isFinite(rawStall)
    ? Math.max(1, Math.min(720, rawStall))
    : DEFAULT_STALL_HOURS;
  const stallMs = stallHours * 3_600_000;

  let flows: OnboardingState[] = [];
  let loadError: string | null = null;
  try {
    flows = await listRecentFlows({ limit: FLOW_LIMIT });
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  const now = new Date();
  let rows = flows.map((f) => summarize(f, stallMs, now));
  if (stalledOnly) {
    rows = rows.filter((r) => r.stalled);
  }

  const stalledCount = rows.filter((r) => r.stalled).length;
  const completedCount = rows.filter((r) => r.nextStep === null).length;

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Wholesale onboarding flows</h1>
        <div className="text-sm text-gray-600">
          {rows.length} shown · {stalledCount} stalled · {completedCount}{" "}
          completed
        </div>
      </header>

      <nav className="mb-4 flex gap-3 text-sm">
        <Link
          href="/ops/wholesale/onboarding"
          className={`border px-3 py-1 ${stalledOnly ? "border-gray-300" : "border-gray-900 bg-gray-900 text-white"}`}
        >
          All
        </Link>
        <Link
          href="/ops/wholesale/onboarding?stalledOnly=true"
          className={`border px-3 py-1 ${stalledOnly ? "border-red-700 bg-red-700 text-white" : "border-gray-300"}`}
        >
          Stalled only
        </Link>
        <span className="ml-auto self-center text-xs text-gray-500">
          stall threshold: {stallHours}h
        </span>
      </nav>

      {loadError ? (
        <div className="mb-4 border-2 border-red-500 bg-red-50 p-3 text-sm text-red-900">
          KV read failed: {loadError}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="border-2 border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-600">
          {stalledOnly
            ? "No stalled flows. Nothing to chase."
            : "No wholesale flows in flight yet."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-gray-900 bg-gray-50 text-left">
                <th className="p-2">Company</th>
                <th className="p-2">Contact</th>
                <th className="p-2">Step</th>
                <th className="p-2">Next</th>
                <th className="p-2">Pay</th>
                <th className="p-2">Order</th>
                <th className="p-2">Last touch</th>
                <th className="p-2">Status</th>
                <th className="p-2">View</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.flowId}
                  className={`border-b border-gray-200 ${r.stalled ? "bg-red-50" : ""}`}
                >
                  <td className="p-2 font-medium">
                    {r.prospect?.companyName ?? (
                      <em className="text-gray-400">unknown</em>
                    )}
                  </td>
                  <td className="p-2 text-gray-700">
                    {r.prospect?.contactName ?? "—"}
                    <br />
                    <span className="text-xs text-gray-500">
                      {r.prospect?.contactEmail ?? "—"}
                    </span>
                  </td>
                  <td className="p-2 font-mono text-xs">{r.currentStep}</td>
                  <td className="p-2 font-mono text-xs">
                    {r.nextStep ?? "—"}
                  </td>
                  <td className="p-2 text-xs">{r.paymentPath ?? "—"}</td>
                  <td className="p-2">
                    {r.orderLineCount > 0 ? (
                      <>
                        {r.orderLineCount} line{r.orderLineCount === 1 ? "" : "s"}
                        <br />
                        <span className="text-xs text-gray-500">
                          ${r.totalSubtotalUsd.toFixed(2)}
                        </span>
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="p-2 text-xs">
                    {r.hoursSinceLastTouch !== null
                      ? `${r.hoursSinceLastTouch.toFixed(0)}h ago`
                      : "—"}
                  </td>
                  <td className="p-2 text-xs">
                    {r.nextStep === null ? (
                      <span className="font-bold text-green-700">
                        ✓ Complete
                      </span>
                    ) : r.stalled ? (
                      <span className="font-bold text-red-700">⚠ Stalled</span>
                    ) : (
                      <span className="text-gray-600">In flight</span>
                    )}
                  </td>
                  <td className="p-2">
                    <Link
                      href={`/wholesale/order?flowId=${encodeURIComponent(r.flowId)}`}
                      className="text-xs text-blue-700 underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      open ↗
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="mt-6 text-xs text-gray-500">
        <p>
          Reads `wholesale:flow:index` from KV. 30-day TTL per flow record.
          Stalled = nextStep != null AND last step transition older than {stallHours}h.
        </p>
      </footer>
    </div>
  );
}
