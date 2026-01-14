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
      window.dispatchEvent(new Event("cart:updated"));
      onChange?.();
    });
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
      <div className="flex overflow-hidden rounded-full border border-white/15 bg-white/5">
        <button
          type="button"
          onClick={() => submitUpdate(quantity - 1)}
          disabled={pending || quantity <= 1}
          className={cn(
            "pressable focus-ring px-3 py-2 text-white/80 hover:bg-white/10 hover:text-white",
            (pending || quantity <= 1) && "opacity-60 pointer-events-none"
          )}
          aria-label="Decrease quantity"
        >
          -
        </button>

        <div
          className="min-w-[44px] px-3 flex items-center justify-center font-black text-white"
          aria-label="Quantity"
        >
          {quantity}
        </div>

        <button
          type="button"
          onClick={() => submitUpdate(quantity + 1)}
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
