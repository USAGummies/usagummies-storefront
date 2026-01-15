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
      <div className="flex items-center gap-1 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-1">
        <button
          type="button"
          onClick={() => {
            const next = Math.max(1, quantity - 1);
            submitUpdate(next);
          }}
          disabled={pending || quantity <= 1}
          className={cn(
            "pressable focus-ring px-3 py-2 text-[var(--text)] hover:bg-white",
            (pending || quantity <= 1) && "opacity-60 pointer-events-none"
          )}
          aria-label="Decrease quantity"
        >
          -
        </button>

        <div
          className="w-12 rounded-full border border-[var(--border)] bg-white px-2 py-1 text-center text-xs font-semibold text-[var(--text)]"
          aria-live="polite"
          aria-label="Quantity"
        >
          {quantity}
        </div>

        <button
          type="button"
          onClick={() => {
            const next = Math.max(1, quantity + 1);
            submitUpdate(next);
          }}
          disabled={pending}
          className={cn(
            "pressable focus-ring px-3 py-2 text-[var(--text)] hover:bg-white",
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
          "pressable focus-ring rounded-full border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:border-[rgba(15,27,45,0.3)]",
          pending && "opacity-60 pointer-events-none"
        )}
      >
        Remove
      </button>

      {pending ? <span className="text-xs text-[var(--muted)]">Updating...</span> : null}
    </div>
  );
}
