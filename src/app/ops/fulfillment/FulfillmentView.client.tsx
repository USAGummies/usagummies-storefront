"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  DtcOrder,
  FulfillmentPayload,
  ManualPending,
  SampleLead,
  WholesaleInvoice,
} from "@/app/api/ops/fulfillment/route";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function daysFromNow(iso: string | null): string {
  if (!iso) return "";
  const diff = (new Date(iso).getTime() - Date.now()) / (24 * 3600 * 1000);
  const days = Math.round(diff);
  if (days === 0) return "today";
  if (days > 0) return `in ${days}d`;
  return `${Math.abs(days)}d ago`;
}

const STATUS_COLORS: Record<WholesaleInvoice["status"], string> = {
  draft: "#f59e0b",
  outstanding: "#2563eb",
  paid: "#16a34a",
};

export function FulfillmentView() {
  const [data, setData] = useState<FulfillmentPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ops/fulfillment", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json as FulfillmentPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load fulfillment queue");
    } finally {
      setLoading(false);
    }
  }, []);

  const markShipped = useCallback(
    async (key: string, label: string) => {
      const tracking = window.prompt(`Tracking # for "${label}" (optional):`, "");
      if (tracking === null) return; // user cancelled
      setBusyKey(key);
      try {
        const res = await fetch("/api/ops/fulfillment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, tracking: tracking || undefined }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
        await load();
      } catch (e) {
        window.alert(
          `Failed to mark shipped: ${e instanceof Error ? e.message : "unknown"}`,
        );
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Fulfillment Queue</h1>
          <p className="mt-1 text-sm text-neutral-600">
            What to ship from Ashford today — unions Shopify DTC, QBO wholesale invoices,
            committed-but-not-invoiced pending orders, and sample-request emails.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {data && (
        <>
          <SummaryBar data={data} />
          {data.degraded.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <strong>Degraded sources:</strong> {data.degraded.join(" | ")}
            </div>
          )}
          <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <PendingCommitmentsCard
              items={data.manualPending}
              onMarkShipped={markShipped}
              busyKey={busyKey}
            />
            <WholesaleCard
              items={data.wholesale}
              onMarkShipped={markShipped}
              busyKey={busyKey}
            />
            <DtcCard items={data.dtc} onMarkShipped={markShipped} busyKey={busyKey} />
            <SamplesCard items={data.samples} />
          </div>
        </>
      )}

      {loading && !data && <div className="text-sm text-neutral-500">Loading…</div>}
    </div>
  );
}

function SummaryBar({ data }: { data: FulfillmentPayload }) {
  const totalShipTodayBags =
    data.totals.wholesaleBags + data.totals.manualPendingBags;
  const totalShipTodayCases =
    Math.round(((totalShipTodayBags) / 36) * 100) / 100;

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
      <Stat label="Wholesale cases" value={data.totals.wholesaleCases.toString()} />
      <Stat
        label="Pending commits"
        value={`${data.totals.manualPendingCases} cases`}
        sub={`${data.totals.manualPendingBags} bags`}
        alert={data.totals.manualPendingCases > 0}
      />
      <Stat label="DTC orders" value={data.totals.dtcOrders.toString()} />
      <Stat label="Sample leads" value={data.totals.samplesPending.toString()} />
      <Stat
        label="Bags to ship"
        value={totalShipTodayBags.toString()}
        sub={`${totalShipTodayCases} cases`}
        highlight
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
  alert,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        highlight
          ? "border-[#b22234] bg-red-50"
          : alert
          ? "border-amber-300 bg-amber-50"
          : "border-neutral-200 bg-white"
      }`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-neutral-600">{sub}</div>}
    </div>
  );
}

function Card({
  title,
  count,
  subtitle,
  children,
}: {
  title: string;
  count: number;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>}
        </div>
        <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold">{count}</span>
      </div>
      {count === 0 ? (
        <div className="rounded-md bg-neutral-50 p-4 text-sm text-neutral-500">Nothing queued.</div>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
    </section>
  );
}

function PendingCommitmentsCard({
  items,
  onMarkShipped,
  busyKey,
}: {
  items: ManualPending[];
  onMarkShipped: (key: string, label: string) => void;
  busyKey: string | null;
}) {
  return (
    <Card
      title="Pending commitments"
      count={items.length}
      subtitle="Orders we committed to in email / Slack that are not yet on a QBO invoice. Ship, then invoice."
    >
      {items.map((it) => {
        const key = `pending:${it.slug}`;
        return (
          <div key={key} className="rounded-md border-l-4 border-amber-400 bg-amber-50 p-3">
            <div className="flex items-baseline justify-between">
              <div className="font-semibold">{it.customer}</div>
              <div className="text-sm font-semibold">
                {it.cases} cases <span className="text-neutral-500">({it.bags} bags)</span>
              </div>
            </div>
            {it.targetShipBy && (
              <div className="mt-0.5 text-xs text-neutral-700">
                Target ship-by: <strong>{it.targetShipBy}</strong> ({daysFromNow(it.targetShipBy)})
              </div>
            )}
            <div className="mt-1 text-xs text-neutral-700">{it.reason}</div>
            <div className="mt-1 text-[10px] text-neutral-500">Source: {it.source}</div>
            <ShipButton
              onClick={() => onMarkShipped(key, `${it.customer} — ${it.cases} cases (pending)`)}
              busy={busyKey === key}
            />
          </div>
        );
      })}
    </Card>
  );
}

function ShipButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="mt-2 rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50"
    >
      {busy ? "Saving…" : "Mark shipped →"}
    </button>
  );
}

function WholesaleCard({
  items,
  onMarkShipped,
  busyKey,
}: {
  items: WholesaleInvoice[];
  onMarkShipped: (key: string, label: string) => void;
  busyKey: string | null;
}) {
  return (
    <Card
      title="Wholesale invoices (QBO)"
      count={items.length}
      subtitle="Draft invoices sit first — Rene may need to send before ship. Paid = verify already shipped."
    >
      {items.map((inv) => {
        const key = `inv:${inv.id}`;
        return (
          <div key={key} className="rounded-md border border-neutral-200 p-3">
            <div className="flex items-baseline justify-between">
              <div className="font-semibold">{inv.customer}</div>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white"
                style={{ background: STATUS_COLORS[inv.status] }}
              >
                {inv.status}
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between text-sm">
              <div className="text-neutral-700">
                #{inv.docNumber || inv.id} · {inv.txnDate || "—"}
                {inv.dueDate && <> · due {inv.dueDate}</>}
              </div>
              <div className="font-semibold">
                {inv.cases !== null && <span>{inv.cases} cases </span>}
                {inv.bags !== null && <span className="text-neutral-500">({inv.bags} bags)</span>}
                <span className="ml-2">· {money(inv.amount)}</span>
              </div>
            </div>
            {inv.shipAddr && (
              <div className="mt-1 text-xs text-neutral-600">→ {inv.shipAddr}</div>
            )}
            {inv.memo && <div className="mt-1 text-xs italic text-neutral-600">{inv.memo}</div>}
            {inv.shipVerifyTodo && (
              <div className="mt-1 text-[11px] text-amber-700">
                ⚠ Paid — verify shipment went out. (ShipStation cross-ref not yet wired.)
              </div>
            )}
            <ShipButton
              onClick={() =>
                onMarkShipped(
                  key,
                  `${inv.customer} — Invoice #${inv.docNumber || inv.id}`,
                )
              }
              busy={busyKey === key}
            />
          </div>
        );
      })}
    </Card>
  );
}

function DtcCard({
  items,
  onMarkShipped,
  busyKey,
}: {
  items: DtcOrder[];
  onMarkShipped: (key: string, label: string) => void;
  busyKey: string | null;
}) {
  return (
    <Card
      title="DTC orders (Shopify)"
      count={items.length}
      subtitle="Paid + unfulfilled Shopify orders, last 30 days."
    >
      {items.map((o) => {
        const key = `dtc:${o.id}`;
        return (
          <div key={key} className="rounded-md border border-neutral-200 p-3">
            <div className="flex items-baseline justify-between">
              <div className="font-semibold">
                {o.name} · {o.customer}
              </div>
              <div className="text-sm font-semibold">{money(o.total)}</div>
            </div>
            <div className="mt-1 text-xs text-neutral-600">
              {o.email} · {new Date(o.createdAt).toLocaleDateString()} · {o.fulfillmentStatus}
            </div>
            <ShipButton
              onClick={() => onMarkShipped(key, `${o.customer} — Shopify ${o.name}`)}
              busy={busyKey === key}
            />
          </div>
        );
      })}
    </Card>
  );
}

function SamplesCard({ items }: { items: SampleLead[] }) {
  return (
    <Card
      title="Sample-request queue (Gmail, best-effort)"
      count={items.length}
      subtitle="Parsed from inbox last 21d. Confidence flag reflects address-signal strength. Verify each before packing."
    >
      {items.map((s) => (
        <div key={s.threadId || s.subject} className="rounded-md border border-neutral-200 p-3">
          <div className="flex items-baseline justify-between">
            <div className="font-semibold text-sm">{s.subject}</div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white ${
                s.confidence === "high"
                  ? "bg-green-600"
                  : s.confidence === "medium"
                  ? "bg-amber-500"
                  : "bg-neutral-400"
              }`}
            >
              {s.confidence}
            </span>
          </div>
          <div className="mt-1 text-xs text-neutral-700">{s.counterparty}</div>
          <div className="mt-1 text-xs text-neutral-600 line-clamp-2">{s.snippet}</div>
          <div className="mt-1 flex items-baseline justify-between text-[11px] text-neutral-500">
            <span>{new Date(s.lastMessageDate).toLocaleDateString()}</span>
            {s.threadLink && (
              <a
                href={s.threadLink}
                target="_blank"
                rel="noreferrer"
                className="text-[#b22234] underline"
              >
                Open thread ↗
              </a>
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}
