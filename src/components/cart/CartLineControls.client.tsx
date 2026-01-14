// src/components/cart/CartLineControls.client.tsx
"use client";

import { useEffect, useState, useTransition } from "react";
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
  const [manualQty, setManualQty] = useState(String(quantity));

  useEffect(() => {
    setManualQty(String(quantity));
  }, [quantity]);

  function submitUpdate(nextQty: number) {
    if (pending) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("lineId", lineId);
      fd.set("quantity", String(Math.max(0, nextQty)));
      await updateLine(fd);
      window.dispatchEvent(new Event("cart:updated"));
      onChange?.();
    });
  }

  function commitManualQty() {
    if (pending) return;
    const next = Math.max(1, Math.round(Number(manualQty)));
    if (!Number.isFinite(next)) {
      setManualQty(String(quantity));
      return;
    }
    if (next !== quantity) {
      submitUpdate(next);
    }
  }

  function submitRemove() {
    if (pending) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("lineId", lineId);
      await removeLine(fd);
      window.dispatchEvent(new Event("cart:updated"));
      onChange?.();
    });
  }

  
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 overflow-hidden rounded-full border border-white/15 bg-white/5 px-1">
        <button
          type="button"
          onClick={() => {
            const next = Math.max(1, quantity - 1);
            setManualQty(String(next));
            submitUpdate(next);
          }}
          disabled={pending || quantity <= 1}
          className={cn(
            "pressable focus-ring px-3 py-2 text-white/80 hover:bg-white/10 hover:text-white",
            (pending || quantity <= 1) && "opacity-60 pointer-events-none"
          )}
          aria-label="Decrease quantity"
        >
          -
        </button>

        <input
          type="number"
          inputMode="numeric"
          min={1}
          value={manualQty}
          onChange={(e) => setManualQty(e.target.value)}
          onBlur={commitManualQty}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitManualQty();
            }
          }}
          className="w-16 rounded-full border border-white/10 bg-white/10 px-2 py-1 text-center text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[var(--gold)]"
          aria-label="Quantity"
        />

        <button
          type="button"
          onClick={() => {
            const next = Math.max(1, quantity + 1);
            setManualQty(String(next));
            submitUpdate(next);
          }}
          disabled={pending}
          className={cn(
            "pressable focus-ring px-3 py-2 text-white/80 hover:bg-white/10 hover:text-white",
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
          "pressable focus-ring rounded-full border border-white/15 px-3 py-2 text-xs font-semibold text-white/80 hover:border-white/40 hover:text-white",
          pending && "opacity-60 pointer-events-none"
        )}
      >
        Remove
      </button>

      {pending ? <span className="text-xs text-white/60">Updating...</span> : null}
    </div>
  );
}
