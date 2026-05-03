"use client";

import type {
  ChannelMarginRow,
  ChannelMarginsTable,
} from "@/lib/finance/channel-margins/types";

interface ChannelMarginsViewProps {
  table: ChannelMarginsTable;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtPct(pct: number): string {
  // grossMarginPct stored as a 0..1 fraction
  return `${(pct * 100).toFixed(1)}%`;
}

function rowAccentColor(row: ChannelMarginRow): string {
  if (row.belowMarginFloor) return "bg-red-50 border-l-4 border-red-500";
  if (row.grossMarginPct >= 0.5) return "bg-emerald-50";
  if (row.grossMarginPct >= 0.25) return "bg-yellow-50";
  return "bg-orange-50";
}

function unavailableMarker(
  row: ChannelMarginRow,
  cell: "channelFees" | "shipping",
): string | null {
  if (cell === "channelFees" && row.unavailable.channelFees) return "[est]";
  if (cell === "shipping" && row.unavailable.shipping) return "[est]";
  return null;
}

export function ChannelMarginsView({ table }: ChannelMarginsViewProps) {
  const { rows, summary, marginFloorUsd, sources, asOf } = table;
  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-slate-900">
          Channel Margins
        </h1>
        <p className="text-sm text-slate-600">
          Per-bag economics across every channel. Cells flagged{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
            [est]
          </code>{" "}
          are doctrine estimates, not QBO actuals — replace as the
          receipt-OCR + Amazon SP-API settlement integration paths land.
          Margin floor: <strong>{fmtUsd(marginFloorUsd)}</strong>/bag (per
          off-grid pricing escalation doctrine — Class C{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
            pricing.change
          </code>{" "}
          required to ship below this).
        </p>
        <p className="text-xs text-slate-500">
          As of: {new Date(asOf).toLocaleString()} · {summary.rowCount} channels
          ·{" "}
          <span
            className={
              summary.belowFloorCount > 0
                ? "font-semibold text-red-600"
                : "text-emerald-600"
            }
          >
            {summary.belowFloorCount} below floor
          </span>
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Channel
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Tier
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Gross / bag
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Channel fees
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                  COGS
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Shipping
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Net / bag
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Margin $
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Margin %
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.channel} className={rowAccentColor(row)}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {row.displayName}
                    {row.belowMarginFloor && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                        below floor
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">
                    {row.pricingTier ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {fmtUsd(row.grossRevenuePerBagUsd)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {row.channelFeesPerBagUsd > 0
                      ? `−${fmtUsd(row.channelFeesPerBagUsd)}`
                      : "—"}
                    {unavailableMarker(row, "channelFees") && (
                      <span className="ml-1 text-xs text-slate-500">
                        {unavailableMarker(row, "channelFees")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    −{fmtUsd(row.cogsPerBagUsd)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {row.shippingCostPerBagUsd > 0
                      ? `−${fmtUsd(row.shippingCostPerBagUsd)}`
                      : "—"}
                    {unavailableMarker(row, "shipping") && (
                      <span className="ml-1 text-xs text-slate-500">
                        {unavailableMarker(row, "shipping")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {fmtUsd(row.netRevenuePerBagUsd)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">
                    {fmtUsd(row.grossMarginPerBagUsd)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {fmtPct(row.grossMarginPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Healthiest channel
          </p>
          <p className="mt-1 text-lg font-semibold text-emerald-900">
            {summary.healthiestChannel
              ? rows.find((r) => r.channel === summary.healthiestChannel)
                  ?.displayName ?? summary.healthiestChannel
              : "—"}
          </p>
          {summary.healthiestChannel && (
            <p className="mt-1 text-sm text-emerald-800">
              {fmtUsd(
                rows.find((r) => r.channel === summary.healthiestChannel)
                  ?.grossMarginPerBagUsd ?? 0,
              )}
              /bag ·{" "}
              {fmtPct(
                rows.find((r) => r.channel === summary.healthiestChannel)
                  ?.grossMarginPct ?? 0,
              )}{" "}
              gross
            </p>
          )}
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Lowest-margin channel
          </p>
          <p className="mt-1 text-lg font-semibold text-amber-900">
            {summary.leastHealthyChannel
              ? rows.find((r) => r.channel === summary.leastHealthyChannel)
                  ?.displayName ?? summary.leastHealthyChannel
              : "—"}
          </p>
          {summary.leastHealthyChannel && (
            <p className="mt-1 text-sm text-amber-800">
              {fmtUsd(
                rows.find((r) => r.channel === summary.leastHealthyChannel)
                  ?.grossMarginPerBagUsd ?? 0,
              )}
              /bag ·{" "}
              {fmtPct(
                rows.find((r) => r.channel === summary.leastHealthyChannel)
                  ?.grossMarginPct ?? 0,
              )}{" "}
              gross
            </p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Cell estimate notes
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          {rows
            .filter(
              (r) =>
                r.unavailable.channelFees ||
                r.unavailable.shipping ||
                r.unavailable.reason,
            )
            .map((r) => (
              <li key={r.channel} className="flex gap-2">
                <span className="font-medium text-slate-900">
                  {r.displayName}:
                </span>
                <span className="text-slate-600">
                  {r.unavailable.reason ?? "estimate"}
                </span>
              </li>
            ))}
        </ul>
      </section>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Sources
        </h2>
        <ul className="mt-3 space-y-1 text-sm text-slate-600">
          {sources.map((s) => (
            <li key={s.system}>
              <code className="rounded bg-white px-1 py-0.5 text-xs">
                {s.system}
              </code>
              {s.note && <span className="ml-2 text-slate-700">{s.note}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
