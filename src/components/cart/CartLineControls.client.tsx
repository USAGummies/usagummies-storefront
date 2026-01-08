// src/components/cart/CartLineControls.client.tsx
"use client";

import { useTransition } from "react";
import { updateLine, removeLine } from "@/app/actions/cart";
import { cn } from "@/lib/cn";

export function CartLineControls({
  lineId,
  quantity,
  onChange,
}: {
  lineId: string;
  quantity: number;
  onChange?: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function submitUpdate(nextQty: number) {
    if (pending) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("lineId", lineId);
      fd.set("quantity", String(Math.max(0, nextQty)));
      await updateLine(fd);
      onChange?.();
    });
  }

  function submitRemove() {
    if (pending) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("lineId", lineId);
      await removeLine(fd);
      onChange?.();
    });
  }

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <div className="flex overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface)]">
        <button
          type="button"
          onClick={() => submitUpdate(quantity - 1)}
          disabled={pending || quantity <= 1}
          className={cn(
            "btn btn-navy pressable focus-ring",
            "rounded-none px-3",
            (pending || quantity <= 1) && "opacity-60 pointer-events-none"
          )}
          aria-label="Decrease quantity"
        >
          −
        </button>

        <div className="min-w-[44px] px-3 flex items-center justify-center font-black text-white" aria-label="Quantity">
          {quantity}
        </div>

        <button
          type="button"
          onClick={() => submitUpdate(quantity + 1)}
          disabled={pending}
          className={cn(
            "btn btn-navy pressable focus-ring",
            "rounded-none px-3",
            pending && "opacity-60 pointer-events-none"
          )}
          aria-label="Increase quantity"
        >
          +
        </button>
      </div>

      <button
        type="button"
        onClick={submitRemove}
        disabled={pending}
        className={cn(
          "btn pressable focus-ring rounded-full px-3 py-2",
          pending && "opacity-60 pointer-events-none"
        )}
      >
        Remove
      </button>

      {pending ? (
        <span style={{ fontSize: 12, opacity: 0.75 }}>Updating…</span>
      ) : null}
    </div>
  );
}
