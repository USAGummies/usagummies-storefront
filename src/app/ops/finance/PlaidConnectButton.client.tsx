"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { usePlaidLink } from "react-plaid-link";
import { Landmark } from "lucide-react";
import { NAVY, GOLD } from "@/app/ops/tokens";

type PlaidConnectButtonProps = {
  onSuccess?: () => void;
};

export function PlaidConnectButton({ onSuccess }: PlaidConnectButtonProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const openedRef = useRef(false);

  const fetchLinkToken = useCallback(async () => {
    setLoading(true);
    setError(null);
    openedRef.current = false;
    try {
      const res = await fetch("/api/ops/plaid/link-token", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get link token");
      setLinkToken(data.linkToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize Plaid");
      setLoading(false);
    }
  }, []);

  const onPlaidSuccess = useCallback(
    async (publicToken: string) => {
      try {
        const res = await fetch("/api/ops/plaid/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicToken }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Token exchange failed");
        setConnected(true);
        onSuccess?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to connect bank");
      } finally {
        setLoading(false);
      }
    },
    [onSuccess],
  );

  // Link-token flow: env is encoded in the token, no env prop needed
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: onPlaidSuccess,
    onExit: () => setLoading(false),
  });

  // Auto-open Plaid Link once token is ready (useEffect avoids calling open() during render)
  useEffect(() => {
    if (linkToken && ready && loading && !openedRef.current) {
      openedRef.current = true;
      open();
    }
  }, [linkToken, ready, loading, open]);

  if (connected) {
    return (
      <div
        style={{
          border: "1px solid rgba(22,163,74,0.3)",
          background: "rgba(22,163,74,0.06)",
          borderRadius: 10,
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Landmark size={18} color="#16a34a" />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#16a34a" }}>
            Bank Connected
          </div>
          <div style={{ fontSize: 12, color: "rgba(22,163,74,0.7)" }}>
            Refresh the page to see live balances and transactions.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        border: `1px solid ${GOLD}55`,
        background: `${GOLD}12`,
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Landmark size={18} color={NAVY} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>
            Connect Your Bank Account
          </div>
          <div style={{ fontSize: 12, color: "rgba(27,42,74,0.6)" }}>
            Link your Bank of America account via Plaid to see live cash position, transactions, and P&L actuals.
          </div>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: "#c7362c", fontWeight: 600 }}>
          {error}
        </div>
      )}

      <button
        onClick={fetchLinkToken}
        disabled={loading}
        style={{
          alignSelf: "flex-start",
          background: NAVY,
          color: "#fff",
          border: "none",
          borderRadius: 8,
          padding: "8px 18px",
          fontSize: 13,
          fontWeight: 700,
          cursor: loading ? "wait" : "pointer",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? "Connecting..." : "Connect Bank via Plaid"}
      </button>
    </div>
  );
}
