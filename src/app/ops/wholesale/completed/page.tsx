/**
 * /ops/wholesale/completed — Phase 35.f.7.b
 *
 * Auth-gated browser surface for Rene's monthly close + month-end
 * cadence. Lists completed wholesale onboarding flows in a table,
 * summed by paymentPath. Mirrors the `/ops/wholesale/onboarding`
 * page pattern (server component, Tailwind table, no interactivity
 * beyond ?days= query toggle).
 *
 * Reads `listRecentAuditEnvelopes` directly server-side. Auth via
 * the existing /ops/* middleware (session-only).
 */
import type { Metadata } from "next";
import Link from "next/link";

import {
  listRecentAuditEnvelopes,
  type AuditEnvelope,
} from "@/lib/wholesale/onboarding-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Wholesale completed flows",
};

interface SearchParams {
  days?: string;
  limit?: string;
}

const COMMON_WINDOWS = [7, 30, 60, 90, 180];
const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 200;

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export default async function OpsWholesaleCompletedPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const rawDays = Number.parseInt(params.days ?? String(DEFAULT_DAYS), 10);
  const days = Number.isFinite(rawDays)
    ? Math.max(1, Math.min(365, rawDays))
    : DEFAULT_DAYS;
  const rawLimit = Number.parseInt(
    params.limit ?? String(DEFAULT_LIMIT),
    10,
  );
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(500, rawLimit))
    : DEFAULT_LIMIT;

  let envelopes: AuditEnvelope[] = [];
  let loadError: string | null = null;
  try {
    envelopes = await listRecentAuditEnvelopes({ withinDays: days, limit });
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  // Aggregate by paymentPath.
  const buckets: Record<
    "credit-card" | "accounts-payable" | "unknown",
    { count: number; subtotalUsd: number }
  > = {
    "credit-card": { count: 0, subtotalUsd: 0 },
    "accounts-payable": { count: 0, subtotalUsd: 0 },
    unknown: { count: 0, subtotalUsd: 0 },
  };
  let totalSubtotalUsd = 0;
  for (const env of envelopes) {
    const subtotal = env.totalSubtotalUsd ?? 0;
    totalSubtotalUsd += subtotal;
    const path = env.paymentPath ?? "unknown";
    buckets[path].count += 1;
    buckets[path].subtotalUsd += subtotal;
  }
  totalSubtotalUsd = Math.round(totalSubtotalUsd * 100) / 100;
  for (const k of Object.keys(buckets) as (keyof typeof buckets)[]) {
    buckets[k].subtotalUsd =
      Math.round(buckets[k].subtotalUsd * 100) / 100;
  }

  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Wholesale completed flows</h1>
        <div className="text-sm text-gray-600">
          last {days} days · {envelopes.length} completed · $
          {totalSubtotalUsd.toFixed(2)} subtotal
        </div>
      </header>

      <nav className="mb-4 flex flex-wrap gap-3 text-sm">
        {COMMON_WINDOWS.map((d) => (
          <Link
            key={d}
            href={`/ops/wholesale/completed?days=${d}`}
            className={`border px-3 py-1 ${
              d === days
                ? "border-gray-900 bg-gray-900 text-white"
                : "border-gray-300"
            }`}
          >
            {d}d
          </Link>
        ))}
        <Link
          href="/ops/wholesale/onboarding"
          className="ml-auto self-center text-xs text-blue-700 underline"
        >
          ← In-flight flows
        </Link>
      </nav>

      {loadError ? (
        <div className="mb-4 border-2 border-red-500 bg-red-50 p-3 text-sm text-red-900">
          KV read failed: {loadError}
        </div>
      ) : null}

      {/* Bucket summary */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <BucketCard
          label="Credit card"
          color="bg-green-50 border-green-700"
          count={buckets["credit-card"].count}
          subtotalUsd={buckets["credit-card"].subtotalUsd}
        />
        <BucketCard
          label="AP / Net terms"
          color="bg-blue-50 border-blue-700"
          count={buckets["accounts-payable"].count}
          subtotalUsd={buckets["accounts-payable"].subtotalUsd}
        />
        <BucketCard
          label="Unknown / legacy"
          color="bg-gray-50 border-gray-500"
          count={buckets.unknown.count}
          subtotalUsd={buckets.unknown.subtotalUsd}
        />
      </div>

      {envelopes.length === 0 ? (
        <div className="border-2 border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-600">
          No completed flows in this window. (Showing {since.toLocaleDateString()}{" "}
          → today.)
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-gray-900 bg-gray-50 text-left">
                <th className="p-2">Completed</th>
                <th className="p-2">Company</th>
                <th className="p-2">Pay</th>
                <th className="p-2">Lines</th>
                <th className="p-2">Subtotal</th>
                <th className="p-2">HubSpot</th>
                <th className="p-2">Flow</th>
              </tr>
            </thead>
            <tbody>
              {envelopes.map((e) => (
                <tr
                  key={e.flowId}
                  className="border-b border-gray-200"
                >
                  <td className="p-2 text-xs text-gray-700">
                    {formatDate(e.completedAt)}
                  </td>
                  <td className="p-2 font-medium">
                    {e.prospect?.companyName ?? (
                      <em className="text-gray-400">unknown</em>
                    )}
                    <br />
                    <span className="text-xs text-gray-500">
                      {e.prospect?.contactEmail ?? "—"}
                    </span>
                  </td>
                  <td className="p-2 text-xs">
                    {e.paymentPath === "credit-card" ? (
                      <span className="text-green-700">CC</span>
                    ) : e.paymentPath === "accounts-payable" ? (
                      <span className="text-blue-700">AP</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="p-2">{e.orderLineCount}</td>
                  <td className="p-2 font-mono text-xs">
                    {e.totalSubtotalUsd !== undefined
                      ? `$${e.totalSubtotalUsd.toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="p-2 font-mono text-xs">
                    {e.hubspotDealId ?? "—"}
                  </td>
                  <td className="p-2 font-mono text-xs">{e.flowId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="mt-6 text-xs text-gray-500">
        <p>
          Reads `wholesale:audit:flow-complete:index` from KV. 365-day TTL
          per envelope. Window: last {days} days (
          {since.toLocaleDateString()} → today). For programmatic / cron
          access, use{" "}
          <code>GET /api/ops/wholesale/completed?days={days}</code>.
        </p>
      </footer>
    </div>
  );
}

function BucketCard({
  label,
  color,
  count,
  subtotalUsd,
}: {
  label: string;
  color: string;
  count: number;
  subtotalUsd: number;
}) {
  return (
    <div className={`border-2 p-3 ${color}`}>
      <div className="text-xs uppercase tracking-wide text-gray-700">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold">
        {count} <span className="text-sm font-normal">flows</span>
      </div>
      <div className="text-sm text-gray-700">
        ${subtotalUsd.toFixed(2)} subtotal
      </div>
    </div>
  );
}
