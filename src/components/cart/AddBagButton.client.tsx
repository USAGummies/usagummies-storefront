"use client";

import * as React from "react";

type Props = {
  label?: string;
  pendingLabel?: string;
  disabled?: boolean;

  // New-style API (preferred)
  onAdd?: () => Promise<void> | void;

  // Legacy API (used by CartView.tsx right now)
  lineId?: string;
  currentQty?: number;
  onAdded?: () => void;
  onPending?: (p: boolean) => void;
};

export default function AddBagButton({
  label,
  pendingLabel = "Adding...",
  disabled,
  onAdd,
  lineId,
  currentQty = 1,
  onAdded,
  onPending,
}: Props) {
  const [pending, startTransition] = React.useTransition();

  const addOne = () => {
    startTransition(() => {
      void (async () => {
        onPending?.(true);
        try {
          if (onAdd) {
            await onAdd();
            onAdded?.();
            return;
          }

          if (!lineId) {
            throw new Error("AddBagButton: missing onAdd or lineId");
          }

          const cartId =
            typeof window !== "undefined" ? window.localStorage.getItem("cartId") : null;
          if (cartId && typeof document !== "undefined") {
            document.cookie = `cartId=${cartId}; path=/; samesite=lax`;
          }
          const res = await fetch("/api/cart", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "update",
              lineId,
              quantity: (currentQty || 1) + 1,
              cartId: cartId || undefined,
            }),
          });

          const json = await res.json().catch(() => ({}));
          if (!res.ok || json?.ok === false) {
            throw new Error(json?.error || "Could not update cart.");
          }
          if (json?.cart?.id && typeof window !== "undefined") {
            try {
              window.localStorage.setItem("cartId", json.cart.id);
              document.cookie = `cartId=${json.cart.id}; path=/; samesite=lax`;
            } catch {
              // ignore
            }
          }

          onAdded?.();
        } catch (err) {
          console.error(err);
        } finally {
          onPending?.(false);
        }
      })();
    });
  };

  return (
    <button
      type="button"
      onClick={addOne}
      disabled={Boolean(disabled) || pending}
      className="btn btn-outline pressable focus-ring"
      style={{ opacity: pending ? 0.6 : 1, minWidth: 120 }}
    >
      {pending ? pendingLabel : label || "Add bags"}
    </button>
  );
}
