// src/components/cart/AddBagButton.client.tsx
"use client";

import { useTransition } from "react";
import { updateLine } from "@/app/actions/cart";

export function AddBagButton({
  lineId,
  currentQty,
  label,
  onAdded,
  onPending,
}: {
  lineId: string;
  currentQty: number;
  label?: string;
  onAdded?: () => void;
  onPending?: (pending: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  function addOne() {
    onPending?.(true);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("lineId", lineId);
      fd.set("quantity", String(currentQty + 1));
      await updateLine(fd);
      onAdded?.();
      onPending?.(false);
    });
  }

  return (
    <button
      type="button"
      onClick={addOne}
      disabled={pending}
      className="btn btn-navy pressable focus-ring"
      style={{ opacity: pending ? 0.6 : 1, minWidth: 120 }}
    >
      {pending ? "Adding…" : label || "Add 1 bag"}
    </button>
  );
}
