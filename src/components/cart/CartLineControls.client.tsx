// src/components/cart/CartLineControls.client.tsx
"use client";

import { useTransition } from "react";
import { updateLine, removeLine } from "@/app/actions/cart";

function cx(...a: Array<string | false | null | undefined>) {
  return a.filter(Boolean).join(" ");
}

export function CartLineControls({
  lineId,
  quantity,
}: {
  lineId: string;
  quantity: number;
}) {
  const [pending, startTransition] = useTransition();

  function submitUpdate(nextQty: number) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("lineId", lineId);
      fd.set("quantity", String(Math.max(0, nextQty)));
      await updateLine(fd);
    });
  }

  function submitRemove() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("lineId", lineId);
      await removeLine(fd);
    });
  }

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <div
        style={{
          display: "flex",
          borderRadius: 999,
          overflow: "hidden",
          border: "1px solid rgba(0,0,0,0.12)",
          background: "rgba(255,255,255,0.75)",
        }}
      >
        <button
          type="button"
          onClick={() => submitUpdate(quantity - 1)}
          disabled={pending || quantity <= 1}
          className={cx("btn", "btn-navy")}
          style={{
            borderRadius: 0,
            padding: "10px 12px",
            opacity: pending || quantity <= 1 ? 0.55 : 1,
            pointerEvents: pending || quantity <= 1 ? "none" : "auto",
          }}
          aria-label="Decrease quantity"
        >
          −
        </button>

        <div
          style={{
            minWidth: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 950,
            padding: "0 12px",
            color: "rgba(0,0,0,0.85)",
          }}
          aria-label="Quantity"
        >
          {quantity}
        </div>

        <button
          type="button"
          onClick={() => submitUpdate(quantity + 1)}
          disabled={pending}
          className={cx("btn", "btn-navy")}
          style={{
            borderRadius: 0,
            padding: "10px 12px",
            opacity: pending ? 0.55 : 1,
            pointerEvents: pending ? "none" : "auto",
          }}
          aria-label="Increase quantity"
        >
          +
        </button>
      </div>

      <button
        type="button"
        onClick={submitRemove}
        disabled={pending}
        className="btn"
        style={{
          borderRadius: 999,
          padding: "10px 12px",
          opacity: pending ? 0.55 : 1,
          pointerEvents: pending ? "none" : "auto",
        }}
      >
        Remove
      </button>

      {pending ? (
        <span style={{ fontSize: 12, opacity: 0.75 }}>Updating…</span>
      ) : null}
    </div>
  );
}
