"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  DtcOrder,
  FulfillmentPayload,
  ManualPending,
  SampleLead,
  SampleShip,
  Stage,
  StageEntry,
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

const STAGE_ORDER: Stage[] = ["received", "packed", "ready", "shipped"];
const STAGE_COLORS: Record<Stage, string> = {
  received: "#64748b",
  packed: "#0ea5e9",
  ready: "#f59e0b",
  shipped: "#16a34a",
};
const STAGE_LABELS: Record<Stage, string> = {
  received: "Received",
  packed: "Packed",
  ready: "Ready to ship",
  shipped: "Shipped",
};

// ---------------------------------------------------------------------------
// Shared API helper
// ---------------------------------------------------------------------------

async function postFulfillment<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/ops/fulfillment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json as T;
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function FulfillmentView() {
  const [data, setData] = useState<FulfillmentPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showSampleForm, setShowSampleForm] = useState(false);
  const [labelModal, setLabelModal] = useState<{
    keys: string[];
    label: string;
    cartons: number;
    suggestedAddress: string | null;
  } | null>(null);

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

  const update = useCallback(
    async (key: string, patch: Record<string, unknown>) => {
      setBusyKey(key);
      try {
        await postFulfillment({ key, ...patch });
        await load();
      } catch (e) {
        window.alert(`Failed: ${e instanceof Error ? e.message : "unknown"}`);
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  const createSample = useCallback(
    async (payload: {
      recipient: string;
      company?: string;
      address: string;
      bags: number;
      purpose?: string;
      sourceThreadLink?: string;
    }) => {
      await postFulfillment({ createSample: payload });
      setShowSampleForm(false);
      await load();
    },
    [load],
  );

  const openLabelModal: BuyLabelFn = useCallback(
    (key, label, cartons, suggestedAddress) => {
      setLabelModal({ keys: [key], label, cartons, suggestedAddress });
    },
    [],
  );

  const buyLabel = useCallback(
    async (args: {
      keys: string[];
      destination: {
        name: string;
        company?: string;
        street1: string;
        street2?: string;
        city: string;
        state: string;
        postalCode: string;
      };
      packagingType: "master_carton" | "case";
      cartons: number;
    }) => {
      const res = await fetch("/api/ops/fulfillment/buy-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      return json as {
        ok: true;
        purchased: number;
        totalCost: number;
        trackingNumbers: string[];
      };
    },
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Shipping Hub</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Every open order across channels → pack → ready → shipped. Ships from
            Ashford unless noted.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowSampleForm(true)}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50"
          >
            + Sample ship
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
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
              onUpdate={update}
              onBuyLabel={openLabelModal}
              busyKey={busyKey}
            />
            <WholesaleCard
              items={data.wholesale}
              onUpdate={update}
              onBuyLabel={openLabelModal}
              busyKey={busyKey}
            />
            <DtcCard items={data.dtc} onUpdate={update} onBuyLabel={openLabelModal} busyKey={busyKey} />
            <SampleShipsCard
              items={data.sampleShips}
              onUpdate={update}
              onBuyLabel={openLabelModal}
              busyKey={busyKey}
            />
            <SampleLeadsCard
              items={data.samples}
              onPromote={(_lead) => setShowSampleForm(true)}
              promotedCount={data.sampleShips.length}
            />
          </div>
        </>
      )}

      {loading && !data && <div className="text-sm text-neutral-500">Loading…</div>}

      {showSampleForm && (
        <SampleFormModal
          leads={data?.samples ?? []}
          onSubmit={createSample}
          onClose={() => setShowSampleForm(false)}
        />
      )}

      {labelModal && (
        <BuyLabelModal
          label={labelModal.label}
          keys={labelModal.keys}
          cartons={labelModal.cartons}
          suggestedAddress={labelModal.suggestedAddress}
          onSubmit={async (input) => {
            const result = await buyLabel(input);
            await load();
            setLabelModal(null);
            window.alert(
              `Bought ${result.purchased} label(s) for $${result.totalCost}. Tracking: ${result.trackingNumbers.join(", ")}`,
            );
          }}
          onClose={() => setLabelModal(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function SummaryBar({ data }: { data: FulfillmentPayload }) {
  const totalShipTodayBags = data.totals.shippableTodayBags;
  const totalShipTodayCases = Math.round((totalShipTodayBags / 6) * 100) / 100;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
      <Stat label="Wholesale cases" value={data.totals.wholesaleCases.toString()} />
      <Stat
        label="Pending commits"
        value={`${data.totals.manualPendingCases} cases`}
        sub={`${data.totals.manualPendingBags} bags`}
        alert={data.totals.manualPendingCases > 0}
      />
      <Stat label="DTC orders" value={data.totals.dtcOrders.toString()} />
      <Stat
        label="Sample ships"
        value={data.totals.sampleShips.toString()}
        sub={`${data.totals.sampleBags} bags`}
      />
      <Stat label="Gmail leads" value={data.totals.samplesPending.toString()} sub="unqueued" />
      <Stat
        label="Bags to ship"
        value={totalShipTodayBags.toString()}
        sub={`${totalShipTodayCases} inner cases`}
        highlight
      />
      <StageBreakdown byStage={data.totals.byStage} />
    </div>
  );
}

function StageBreakdown({ byStage }: { byStage: Record<Stage, number> }) {
  return (
    <div className="col-span-2 rounded-lg border border-neutral-200 bg-white p-3 md:col-span-6">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
        Queue by stage
      </div>
      <div className="flex flex-wrap gap-3">
        {STAGE_ORDER.map((s) => (
          <div key={s} className="flex items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white"
              style={{ background: STAGE_COLORS[s] }}
            >
              {STAGE_LABELS[s]}
            </span>
            <span className="text-sm font-semibold">{byStage[s] ?? 0}</span>
          </div>
        ))}
      </div>
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
      className={`rounded-lg border p-3 ${
        highlight
          ? "border-[#b22234] bg-red-50"
          : alert
          ? "border-amber-300 bg-amber-50"
          : "border-neutral-200 bg-white"
      }`}
    >
      <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-neutral-600">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card shell + stage controls
// ---------------------------------------------------------------------------

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

type UpdateFn = (key: string, patch: Record<string, unknown>) => void | Promise<void>;
type BuyLabelFn = (
  key: string,
  label: string,
  cartons: number,
  suggestedAddress: string | null,
) => void | Promise<void>;

function StageControls({
  itemKey,
  stage,
  cartonsRequired,
  onUpdate,
  onBuyLabel,
  busy,
  itemLabel,
  suggestedAddress,
}: {
  itemKey: string;
  stage: StageEntry;
  cartonsRequired: number;
  onUpdate: UpdateFn;
  onBuyLabel?: BuyLabelFn;
  busy: boolean;
  itemLabel: string;
  suggestedAddress?: string | null;
}) {
  const [tracking, setTracking] = useState(stage.tracking ?? "");
  const needRequired = cartonsRequired || stage.cartonsRequired || 1;

  const pack = (delta: number) => {
    const nextPacked = Math.max(0, Math.min(needRequired, stage.cartonsPacked + delta));
    onUpdate(itemKey, { cartonsPacked: nextPacked, cartonsRequired: needRequired });
  };

  return (
    <div className="mt-2 space-y-2">
      {/* Stage pills */}
      <div className="flex flex-wrap items-center gap-1">
        {STAGE_ORDER.map((s) => {
          const active = stage.stage === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onUpdate(itemKey, { stage: s })}
              disabled={busy}
              className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide disabled:opacity-50"
              style={{
                background: active ? STAGE_COLORS[s] : "#f1f5f9",
                color: active ? "white" : "#475569",
              }}
            >
              {STAGE_LABELS[s]}
            </button>
          );
        })}
      </div>

      {/* Packing progress */}
      {needRequired > 1 && stage.stage !== "shipped" && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-neutral-600">
            Packed <strong>{stage.cartonsPacked}</strong>/{needRequired}
          </span>
          <button
            type="button"
            onClick={() => pack(-1)}
            disabled={busy || stage.cartonsPacked <= 0}
            className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs hover:bg-neutral-50 disabled:opacity-30"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => pack(1)}
            disabled={busy || stage.cartonsPacked >= needRequired}
            className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs hover:bg-neutral-50 disabled:opacity-30"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => onUpdate(itemKey, { cartonsPacked: needRequired, cartonsRequired: needRequired })}
            disabled={busy || stage.cartonsPacked >= needRequired}
            className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs font-medium hover:bg-neutral-50 disabled:opacity-30"
          >
            All packed →
          </button>
        </div>
      )}

      {/* Buy label (ShipStation) — enabled on "packed" / "ready" stages */}
      {stage.stage !== "shipped" && onBuyLabel && (
        <button
          type="button"
          onClick={() => onBuyLabel(itemKey, itemLabel, needRequired, suggestedAddress ?? null)}
          disabled={busy}
          className="w-full rounded-md border border-[#b22234] bg-white px-2.5 py-1 text-xs font-semibold text-[#b22234] hover:bg-red-50 disabled:opacity-40"
        >
          🏷 Buy UPS Ground label{needRequired > 1 ? `s (${needRequired})` : ""}
        </button>
      )}

      {/* Tracking # entry (visible once ready, and always visible as a fallback) */}
      {stage.stage !== "shipped" && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Tracking # (paste after ShipStation)"
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs"
          />
          <button
            type="button"
            onClick={() =>
              onUpdate(itemKey, {
                tracking: tracking.trim(),
                stage: "shipped",
              })
            }
            disabled={busy || !tracking.trim()}
            className="rounded-md bg-[#b22234] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#8f1c2a] disabled:opacity-40"
          >
            Mark shipped
          </button>
        </div>
      )}

      {/* Label download + shipped summary */}
      {stage.labelUrl && stage.stage !== "shipped" && (
        <a
          href={stage.labelUrl}
          target="_blank"
          rel="noreferrer"
          className="block text-[11px] text-[#b22234] underline"
        >
          ↓ Download label PDF
        </a>
      )}
      {stage.stage === "shipped" && (
        <div className="text-[11px] text-green-700">
          ✓ Shipped{stage.shippedAt ? ` ${new Date(stage.shippedAt).toLocaleDateString()}` : ""}
          {stage.tracking ? ` · ${stage.tracking}` : ""}
          {stage.labelUrl && (
            <>
              {" · "}
              <a href={stage.labelUrl} target="_blank" rel="noreferrer" className="underline">
                label PDF
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cards per source
// ---------------------------------------------------------------------------

function PendingCommitmentsCard({
  items,
  onUpdate,
  onBuyLabel,
  busyKey,
}: {
  items: ManualPending[];
  onUpdate: UpdateFn;
  onBuyLabel: BuyLabelFn;
  busyKey: string | null;
}) {
  return (
    <Card
      title="Pending commitments"
      count={items.length}
      subtitle="Email / Slack commitments not yet on a QBO invoice. Ship, then invoice."
    >
      {items.map((it) => (
        <div key={it.key} className="rounded-md border-l-4 border-amber-400 bg-amber-50 p-3">
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
          <StageControls
            itemKey={it.key}
            stage={it.stage}
            cartonsRequired={it.cases}
            onUpdate={onUpdate}
            onBuyLabel={onBuyLabel}
            busy={busyKey === it.key}
            itemLabel={`${it.customer} (${it.cases} cases)`}
            suggestedAddress={null}
          />
        </div>
      ))}
    </Card>
  );
}

function WholesaleCard({
  items,
  onUpdate,
  onBuyLabel,
  busyKey,
}: {
  items: WholesaleInvoice[];
  onUpdate: UpdateFn;
  onBuyLabel: BuyLabelFn;
  busyKey: string | null;
}) {
  return (
    <Card
      title="Wholesale invoices (QBO)"
      count={items.length}
      subtitle="Draft invoices need Rene to send before ship. Paid = verify."
    >
      {items.map((inv) => (
        <div key={inv.key} className="rounded-md border border-neutral-200 p-3">
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
          {inv.shipAddr && <div className="mt-1 text-xs text-neutral-600">→ {inv.shipAddr}</div>}
          {inv.memo && <div className="mt-1 text-xs italic text-neutral-600">{inv.memo}</div>}
          {inv.shipVerifyTodo && inv.stage.stage !== "shipped" && (
            <div className="mt-1 text-[11px] text-amber-700">
              ⚠ Paid — verify shipment went out.
            </div>
          )}
          <StageControls
            itemKey={inv.key}
            stage={inv.stage}
            cartonsRequired={inv.cases ?? 0}
            onUpdate={onUpdate}
            onBuyLabel={onBuyLabel}
            busy={busyKey === inv.key}
            itemLabel={`${inv.customer} (#${inv.docNumber || inv.id})`}
            suggestedAddress={inv.shipAddr}
          />
        </div>
      ))}
    </Card>
  );
}

function DtcCard({
  items,
  onUpdate,
  onBuyLabel,
  busyKey,
}: {
  items: DtcOrder[];
  onUpdate: UpdateFn;
  onBuyLabel: BuyLabelFn;
  busyKey: string | null;
}) {
  return (
    <Card title="DTC orders (Shopify)" count={items.length} subtitle="Paid + unfulfilled, last 30 days.">
      {items.map((o) => (
        <div key={o.key} className="rounded-md border border-neutral-200 p-3">
          <div className="flex items-baseline justify-between">
            <div className="font-semibold">
              {o.name} · {o.customer}
            </div>
            <div className="text-sm font-semibold">{money(o.total)}</div>
          </div>
          <div className="mt-1 text-xs text-neutral-600">
            {o.email} · {new Date(o.createdAt).toLocaleDateString()} · {o.fulfillmentStatus}
          </div>
          <StageControls
            itemKey={o.key}
            stage={o.stage}
            cartonsRequired={1}
            onUpdate={onUpdate}
            onBuyLabel={onBuyLabel}
            busy={busyKey === o.key}
            itemLabel={`${o.customer} (Shopify ${o.name})`}
            suggestedAddress={null}
          />
        </div>
      ))}
    </Card>
  );
}

function SampleShipsCard({
  items,
  onUpdate,
  onBuyLabel,
  busyKey,
}: {
  items: SampleShip[];
  onUpdate: UpdateFn;
  onBuyLabel: BuyLabelFn;
  busyKey: string | null;
}) {
  return (
    <Card
      title="Sample ships (queued)"
      count={items.length}
      subtitle="Samples promoted from Gmail leads or manually entered."
    >
      {items.map((s) => (
        <div key={s.key} className="rounded-md border border-dashed border-neutral-300 p-3">
          <div className="flex items-baseline justify-between">
            <div className="font-semibold">
              {s.recipient}
              {s.company && <span className="text-neutral-500"> · {s.company}</span>}
            </div>
            <div className="text-sm font-semibold">{s.bags} bags</div>
          </div>
          <div className="mt-1 text-xs text-neutral-600">→ {s.address}</div>
          <div className="mt-0.5 text-[11px] text-neutral-500">{s.purpose}</div>
          {s.sourceThreadLink && (
            <a
              href={s.sourceThreadLink}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block text-[11px] text-[#b22234] underline"
            >
              Gmail thread ↗
            </a>
          )}
          <StageControls
            itemKey={s.key}
            stage={s.stage}
            cartonsRequired={1}
            onUpdate={onUpdate}
            onBuyLabel={onBuyLabel}
            busy={busyKey === s.key}
            itemLabel={`Sample → ${s.recipient}`}
            suggestedAddress={s.address}
          />
        </div>
      ))}
    </Card>
  );
}

function SampleLeadsCard({
  items,
  onPromote,
  promotedCount,
}: {
  items: SampleLead[];
  onPromote: (lead: SampleLead) => void;
  promotedCount: number;
}) {
  return (
    <Card
      title="Gmail sample leads (unqueued)"
      count={items.length}
      subtitle={`Parsed from inbox last 21d. Click + to promote into a queued sample ship. (${promotedCount} already promoted above.)`}
    >
      {items.map((s) => (
        <div key={s.threadId || s.subject} className="rounded-md border border-neutral-200 p-3">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-semibold">{s.subject}</div>
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
          <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500">
            <span>{new Date(s.lastMessageDate).toLocaleDateString()}</span>
            <div className="flex gap-2">
              {s.threadLink && (
                <a
                  href={s.threadLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#b22234] underline"
                >
                  Open ↗
                </a>
              )}
              <button
                type="button"
                onClick={() => onPromote(s)}
                className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-[11px] font-medium hover:bg-neutral-50"
              >
                + Queue ship
              </button>
            </div>
          </div>
        </div>
      ))}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sample form modal
// ---------------------------------------------------------------------------

function SampleFormModal({
  leads,
  onSubmit,
  onClose,
}: {
  leads: SampleLead[];
  onSubmit: (payload: {
    recipient: string;
    company?: string;
    address: string;
    bags: number;
    purpose?: string;
    sourceThreadLink?: string;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [pickedLeadId, setPickedLeadId] = useState<string>("");
  const [recipient, setRecipient] = useState("");
  const [company, setCompany] = useState("");
  const [address, setAddress] = useState("");
  const [bags, setBags] = useState("2");
  const [purpose, setPurpose] = useState("sample");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const picked = useMemo(
    () => leads.find((l) => l.threadId === pickedLeadId),
    [leads, pickedLeadId],
  );

  const sourceThreadLink = picked?.threadLink ?? "";

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr(null);
    const bagCount = Number.parseInt(bags, 10);
    if (!recipient.trim() || !address.trim() || !Number.isFinite(bagCount) || bagCount <= 0) {
      setErr("Recipient, address, and bags (≥ 1) are required.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        recipient: recipient.trim(),
        company: company.trim() || undefined,
        address: address.trim(),
        bags: bagCount,
        purpose: purpose.trim() || undefined,
        sourceThreadLink: sourceThreadLink || undefined,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-bold">Queue a sample ship</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {leads.length > 0 && (
            <label className="block text-xs font-medium text-neutral-700">
              Promote from Gmail lead (optional)
              <select
                value={pickedLeadId}
                onChange={(e) => {
                  const id = e.target.value;
                  setPickedLeadId(id);
                  const match = leads.find((l) => l.threadId === id);
                  if (match) {
                    // Best-effort prefill from the counterparty string "Name <email>"
                    const nameMatch = /^(.*?)\s*<.+?>$/.exec(match.counterparty);
                    setRecipient(nameMatch?.[1]?.trim() ?? match.counterparty);
                  }
                }}
                className="mt-1 w-full rounded-md border border-neutral-300 p-2 text-sm"
              >
                <option value="">— none (manual entry) —</option>
                {leads.map((l) => (
                  <option key={l.threadId} value={l.threadId}>
                    {l.counterparty.slice(0, 60)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Field
            label="Recipient name"
            value={recipient}
            onChange={setRecipient}
            placeholder="John Schirano"
            required
          />
          <Field
            label="Company (optional)"
            value={company}
            onChange={setCompany}
            placeholder="Delaware North at Yellowstone"
          />
          <label className="block text-xs font-medium text-neutral-700">
            Ship-to address
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={3}
              placeholder="251 Echo Canyon Road&#10;West Yellowstone, MT 59758"
              className="mt-1 w-full rounded-md border border-neutral-300 p-2 text-sm"
              required
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="# bags" value={bags} onChange={setBags} type="number" required />
            <Field label="Purpose" value={purpose} onChange={setPurpose} placeholder="sample" />
          </div>

          {err && <div className="text-sm text-red-700">{err}</div>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-[#b22234] px-4 py-2 text-sm font-semibold text-white hover:bg-[#8f1c2a] disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Queue ship"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-xs font-medium text-neutral-700">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="mt-1 w-full rounded-md border border-neutral-300 p-2 text-sm"
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Buy-label modal (ShipStation purchase)
// ---------------------------------------------------------------------------

function BuyLabelModal({
  label,
  keys,
  cartons: initialCartons,
  suggestedAddress,
  onSubmit,
  onClose,
}: {
  label: string;
  keys: string[];
  cartons: number;
  suggestedAddress: string | null;
  onSubmit: (args: {
    keys: string[];
    destination: {
      name: string;
      company?: string;
      street1: string;
      street2?: string;
      city: string;
      state: string;
      postalCode: string;
    };
    packagingType: "master_carton" | "case";
    cartons: number;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const parsed = useMemo(() => parseSuggestedAddress(suggestedAddress), [suggestedAddress]);
  const [name, setName] = useState(parsed.name);
  const [company, setCompany] = useState(parsed.company);
  const [street1, setStreet1] = useState(parsed.street1);
  const [street2, setStreet2] = useState(parsed.street2);
  const [city, setCity] = useState(parsed.city);
  const [state, setState] = useState(parsed.state);
  const [postalCode, setPostalCode] = useState(parsed.postalCode);
  const [cartons, setCartons] = useState(initialCartons.toString());
  const [packagingType, setPackagingType] = useState<"master_carton" | "case">("master_carton");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr(null);
    const cartonCount = Math.max(1, Number.parseInt(cartons, 10) || 0);
    if (!name.trim() || !street1.trim() || !city.trim() || !state.trim() || !postalCode.trim()) {
      setErr("Name, street, city, state, and postal code are required.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        keys,
        destination: {
          name: name.trim(),
          company: company.trim() || undefined,
          street1: street1.trim(),
          street2: street2.trim() || undefined,
          city: city.trim(),
          state: state.trim().toUpperCase(),
          postalCode: postalCode.trim(),
        },
        packagingType,
        cartons: cartonCount,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Label purchase failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-lg font-bold">Buy UPS Ground label</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-neutral-600">
          {label} · {cartons} carton{Number(cartons) === 1 ? "" : "s"} · From Ashford WA
        </p>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Recipient name" value={name} onChange={setName} required />
            <Field label="Company" value={company} onChange={setCompany} />
          </div>
          <Field label="Street 1" value={street1} onChange={setStreet1} required />
          <Field label="Street 2 (suite / unit)" value={street2} onChange={setStreet2} />
          <div className="grid grid-cols-3 gap-3">
            <Field label="City" value={city} onChange={setCity} required />
            <Field label="State" value={state} onChange={setState} placeholder="WA" required />
            <Field label="ZIP" value={postalCode} onChange={setPostalCode} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-neutral-700">
              Packaging
              <select
                value={packagingType}
                onChange={(e) => setPackagingType(e.target.value as "master_carton" | "case")}
                className="mt-1 w-full rounded-md border border-neutral-300 p-2 text-sm"
              >
                <option value="master_carton">Master carton (21×14×8, 24 lb)</option>
                <option value="case">Inner case (14×10×8, 6 lb)</option>
              </select>
            </label>
            <Field
              label="# cartons (one label each)"
              value={cartons}
              onChange={setCartons}
              type="number"
              required
            />
          </div>

          {err && <div className="rounded bg-red-50 p-2 text-xs text-red-700">{err}</div>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-[#b22234] px-4 py-2 text-sm font-semibold text-white hover:bg-[#8f1c2a] disabled:opacity-50"
            >
              {submitting ? "Buying…" : "Buy + print"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Best-effort parse of the QBO shipAddr string back into fields. QBO stores
 * multi-line addresses that we concatenate with commas when we load; here
 * we split by the last city/state/ZIP pattern. Falls back to manual entry.
 */
function parseSuggestedAddress(raw: string | null): {
  name: string;
  company: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  postalCode: string;
} {
  const empty = { name: "", company: "", street1: "", street2: "", city: "", state: "", postalCode: "" };
  if (!raw) return empty;
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const lastLine = parts[parts.length - 1] || "";
  const zipRe = /(\d{5}(?:-\d{4})?)(?:\s+US)?$/;
  const zipMatch = zipRe.exec(lastLine);
  const postalCode = zipMatch?.[1] ?? "";
  const withoutZip = lastLine.replace(zipRe, "").trim();
  const stateMatch = /\b([A-Z]{2})\b$/.exec(withoutZip);
  const state = stateMatch?.[1] ?? "";
  const city = withoutZip.replace(/\b[A-Z]{2}\b\s*$/, "").trim();
  const upperParts = parts.slice(0, -1);
  // Heuristic: if first part looks like a personal name (no digits), treat it as name.
  const first = upperParts[0] ?? "";
  const looksLikeName = first && !/\d/.test(first) && first.split(/\s+/).length <= 4;
  const name = looksLikeName ? first : "";
  const streetParts = looksLikeName ? upperParts.slice(1) : upperParts;
  return {
    name,
    company: "",
    street1: streetParts[0] ?? "",
    street2: streetParts.slice(1).join(", "),
    city,
    state,
    postalCode,
  };
}
