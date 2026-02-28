"use client";

import {
  NAVY,
  GOLD,
  RED,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

type Props = {
  sessions: number;
  addToCart: number;
  purchases: number;
};

function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function FunnelRow({
  label,
  value,
  widthPct,
  dropOff,
  color,
}: {
  label: string;
  value: number;
  widthPct: number;
  dropOff?: string;
  color: string;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <div style={{ color: NAVY, fontSize: 12, fontWeight: 700 }}>{label}</div>
        <div style={{ color: NAVY, fontSize: 12, fontWeight: 700 }}>{value.toLocaleString("en-US")}</div>
      </div>
      <div style={{ height: 12, borderRadius: 999, background: "rgba(27,42,74,0.08)", overflow: "hidden" }}>
        <div
          style={{
            width: `${Math.max(4, Math.min(100, widthPct))}%`,
            height: "100%",
            borderRadius: 999,
            background: color,
            transition: "width 300ms ease",
          }}
        />
      </div>
      {dropOff ? <div style={{ marginTop: 3, fontSize: 11, color: TEXT_DIM }}>Drop-off: {dropOff}</div> : null}
    </div>
  );
}

export function FunnelChart({ sessions, addToCart, purchases }: Props) {
  const toCartPct = pct(addToCart, sessions);
  const toPurchasePct = pct(purchases, addToCart);

  const cartDropoff = `${Math.max(0, Math.round((100 - toCartPct) * 10) / 10)}%`;
  const purchaseDropoff = `${Math.max(0, Math.round((100 - toPurchasePct) * 10) / 10)}%`;

  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
      <div style={{ color: NAVY, fontWeight: 700, marginBottom: 10 }}>Funnel Snapshot</div>
      <FunnelRow label="Sessions" value={sessions} widthPct={100} color={NAVY} />
      <FunnelRow
        label="Add to Cart"
        value={addToCart}
        widthPct={toCartPct}
        color={GOLD}
        dropOff={cartDropoff}
      />
      <FunnelRow
        label="Purchases"
        value={purchases}
        widthPct={pct(purchases, sessions)}
        color={RED}
        dropOff={purchaseDropoff}
      />
    </div>
  );
}
