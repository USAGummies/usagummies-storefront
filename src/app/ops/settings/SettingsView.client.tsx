"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";

type SettingsUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  lastLogin: string | null;
  active: boolean;
};

type SettingsData = {
  users: SettingsUser[];
  integrations: {
    shopify: boolean;
    plaid: boolean;
    ga4: boolean;
    gmail: boolean;
    notion: boolean;
    amazon: boolean;
    slack: boolean;
  };
  integrationDetails: Array<{
    name: string;
    configured: boolean;
    envVars: { key: string; set: boolean }[];
  }>;
  banking: {
    plaidConfigured: boolean;
    plaidConnected: boolean;
    connectedAt: string | null;
    lastSync: string | null;
  };
  auditTimestamp: string | null;
  version: {
    build: string;
    appVersion: string;
    cacheTtlMinutes: Record<string, number>;
  };
  canEditRoles: boolean;
  generatedAt: string;
  error?: string;
};

const ROLE_OPTIONS = ["admin", "employee", "partner", "investor", "banker"] as const;

const CARD_STYLE: CSSProperties = {
  background: "#1a1d27",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 12,
};

// Window.Plaid types provided by react-plaid-link

function loadPlaidScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Plaid) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-plaid-link="1"]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Plaid script")));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.dataset.plaidLink = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Plaid script"));
    document.head.appendChild(script);
  });
}

export function SettingsView() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [connectingBank, setConnectingBank] = useState(false);
  const [bankingNotice, setBankingNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ops/settings", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SettingsData;
      setData(json);
      setRoleDrafts(
        Object.fromEntries(json.users.map((u) => [u.id, u.role || "employee"])),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function saveRole(userId: string) {
    const role = roleDrafts[userId] || "employee";
    setSavingId(userId);
    setError(null);
    try {
      const res = await fetch("/api/ops/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `HTTP ${res.status}`);
      }
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          users: prev.users.map((u) => (u.id === userId ? { ...u, role } : u)),
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setSavingId(null);
    }
  }

  async function connectFoundBank() {
    if (!data?.banking.plaidConfigured) {
      setBankingNotice("Plaid env vars are missing. Configure PLAID_CLIENT_ID and PLAID_SECRET first.");
      return;
    }

    setConnectingBank(true);
    setBankingNotice(null);
    try {
      const tokenRes = await fetch("/api/ops/plaid/link-token", { method: "POST" });
      if (!tokenRes.ok) {
        const payload = (await tokenRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `HTTP ${tokenRes.status}`);
      }
      const tokenJson = (await tokenRes.json()) as { linkToken?: string };
      if (!tokenJson.linkToken) {
        throw new Error("Missing Plaid link token");
      }

      await loadPlaidScript();
      if (!window.Plaid) {
        throw new Error("Plaid Link failed to initialize");
      }

      window.Plaid.create({
        token: tokenJson.linkToken,
        onSuccess: async (publicToken) => {
          try {
            const exchangeRes = await fetch("/api/ops/plaid/exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ publicToken }),
            });
            if (!exchangeRes.ok) {
              const payload = (await exchangeRes.json().catch(() => ({}))) as { error?: string };
              throw new Error(payload.error || `HTTP ${exchangeRes.status}`);
            }

            await fetch("/api/ops/balances?force=1", { cache: "no-store" }).catch(() => null);
            setBankingNotice("Found.com connected successfully.");
            await refresh();
          } catch (err) {
            setBankingNotice(err instanceof Error ? err.message : "Plaid token exchange failed");
          } finally {
            setConnectingBank(false);
          }
        },
        onExit: (err) => {
          if (err) {
            setBankingNotice("Plaid flow exited before completion.");
          }
          setConnectingBank(false);
        },
      }).open();
    } catch (err) {
      setBankingNotice(err instanceof Error ? err.message : "Unable to start Plaid Link");
      setConnectingBank(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, fontFamily: "var(--font-display)", margin: 0, marginBottom: 8 }}>
            Platform Settings
          </h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.42)", margin: 0 }}>
            User roles, integration health, and NORAD platform metadata.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            color: "rgba(255,255,255,0.85)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            cursor: loading ? "wait" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? (
        <div
          style={{
            background: "rgba(220,38,38,0.1)",
            border: "1px solid rgba(220,38,38,0.2)",
            borderRadius: 8,
            padding: "12px 14px",
            color: "#f87171",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      <section style={{ ...CARD_STYLE, overflowX: "auto" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 12, letterSpacing: "0.07em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", fontWeight: 700 }}>
          User Management
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              {[
                "Name",
                "Email",
                "Role",
                "Last login",
                "Status",
                data?.canEditRoles ? "Actions" : "",
              ].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "10px 16px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(255,255,255,0.45)", fontWeight: 700 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.users || []).map((user) => {
              const draft = roleDrafts[user.id] || user.role || "employee";
              return (
                <tr key={user.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "11px 16px", fontSize: 13, color: "rgba(255,255,255,0.92)" }}>{user.name}</td>
                  <td style={{ padding: "11px 16px", fontSize: 12, color: "rgba(255,255,255,0.65)" }}>{user.email || "-"}</td>
                  <td style={{ padding: "11px 16px" }}>
                    <select
                      value={draft}
                      disabled={!data?.canEditRoles}
                      onChange={(e) => setRoleDrafts((prev) => ({ ...prev, [user.id]: e.target.value }))}
                      style={{
                        background: "#11141d",
                        border: "1px solid rgba(255,255,255,0.12)",
                        color: "rgba(255,255,255,0.9)",
                        borderRadius: 8,
                        padding: "6px 8px",
                        fontSize: 12,
                        fontFamily: "inherit",
                      }}
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "11px 16px", fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
                    {user.lastLogin ? new Date(user.lastLogin).toLocaleString() : "Never"}
                  </td>
                  <td style={{ padding: "11px 16px" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "3px 8px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        color: user.active ? "#4ade80" : "#f87171",
                        background: user.active ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                      }}
                    >
                      {user.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ padding: "11px 16px" }}>
                    {data?.canEditRoles ? (
                      <button
                        onClick={() => saveRole(user.id)}
                        disabled={savingId === user.id || draft === user.role}
                        style={{
                          border: "1px solid rgba(59,130,246,0.35)",
                          background: "rgba(59,130,246,0.12)",
                          color: "#93c5fd",
                          borderRadius: 8,
                          padding: "6px 10px",
                          fontSize: 12,
                          cursor: savingId === user.id ? "wait" : "pointer",
                          opacity: savingId === user.id || draft === user.role ? 0.55 : 1,
                          fontFamily: "inherit",
                        }}
                      >
                        {savingId === user.id ? "Saving..." : "Save"}
                      </button>
                    ) : (
                      <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 12 }}>View only</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && (data?.users || []).length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "22px 16px", color: "rgba(255,255,255,0.4)", fontSize: 13, textAlign: "center" }}>
                  No users found in Platform Users database.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <section style={{ ...CARD_STYLE, padding: "14px 16px" }}>
          <div style={{ fontSize: 12, letterSpacing: "0.07em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", fontWeight: 700, marginBottom: 10 }}>
            Integration Status
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {(data?.integrationDetails || []).map((integration) => (
              <div key={integration.name} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ color: "rgba(255,255,255,0.82)", fontWeight: 600 }}>{integration.name}</span>
                  <span style={{ color: integration.configured ? "#4ade80" : "#f87171", fontWeight: 700 }}>
                    {integration.configured ? "\u2713 Configured" : "\u2717 Missing"}
                  </span>
                </div>
                <div style={{ marginTop: 5, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {integration.envVars.map((envVar) => (
                    <span
                      key={`${integration.name}-${envVar.key}`}
                      style={{
                        borderRadius: 999,
                        padding: "2px 7px",
                        fontSize: 10,
                        letterSpacing: "0.02em",
                        color: envVar.set ? "#4ade80" : "rgba(255,255,255,0.45)",
                        border: `1px solid ${envVar.set ? "rgba(74,222,128,0.35)" : "rgba(255,255,255,0.15)"}`,
                        background: envVar.set ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.03)",
                      }}
                    >
                      {envVar.key}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ ...CARD_STYLE, padding: "14px 16px" }}>
          <div style={{ fontSize: 12, letterSpacing: "0.07em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", fontWeight: 700, marginBottom: 10 }}>
            Banking Connection
          </div>
          <div style={{ display: "grid", gap: 8, fontSize: 13, color: "rgba(255,255,255,0.82)" }}>
            <div>
              Plaid status:{" "}
              <strong style={{ color: data?.banking.plaidConfigured ? "#4ade80" : "#f87171" }}>
                {data?.banking.plaidConfigured ? "Configured" : "Missing env vars"}
              </strong>
            </div>
            <div>
              Found.com link:{" "}
              <strong style={{ color: data?.banking.plaidConnected ? "#4ade80" : "#fbbf24" }}>
                {data?.banking.plaidConnected ? "Connected" : "Not connected"}
              </strong>
            </div>
            <div>
              Connected at:{" "}
              <strong>
                {data?.banking.connectedAt ? new Date(data.banking.connectedAt).toLocaleString() : "—"}
              </strong>
            </div>
            <div>
              Last sync:{" "}
              <strong>
                {data?.banking.lastSync ? new Date(data.banking.lastSync).toLocaleString() : "No sync yet"}
              </strong>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={connectFoundBank}
                disabled={connectingBank || !data?.banking.plaidConfigured}
                style={{
                  border: "1px solid rgba(34,197,94,0.4)",
                  background: "rgba(34,197,94,0.12)",
                  color: "#86efac",
                  borderRadius: 8,
                  padding: "7px 11px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: connectingBank ? "wait" : "pointer",
                  opacity: connectingBank || !data?.banking.plaidConfigured ? 0.55 : 1,
                  fontFamily: "inherit",
                }}
              >
                {connectingBank ? "Connecting..." : data?.banking.plaidConnected ? "Reconnect Found.com" : "Connect Found.com"}
              </button>
            </div>
            {bankingNotice ? (
              <div
                style={{
                  borderRadius: 8,
                  padding: "8px 10px",
                  background: "rgba(59,130,246,0.12)",
                  border: "1px solid rgba(59,130,246,0.3)",
                  color: "#93c5fd",
                  fontSize: 12,
                }}
              >
                {bankingNotice}
              </div>
            ) : null}
          </div>
        </section>

        <section style={{ ...CARD_STYLE, padding: "14px 16px" }}>
          <div style={{ fontSize: 12, letterSpacing: "0.07em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", fontWeight: 700, marginBottom: 10 }}>
            NORAD Version
          </div>
          <div style={{ display: "grid", gap: 8, fontSize: 13, color: "rgba(255,255,255,0.82)" }}>
            <div>Build: <strong>{data?.version.build || "local"}</strong></div>
            <div>App version: <strong>{data?.version.appVersion || "0.1.0"}</strong></div>
            <div>
              Last audit: <strong>{data?.auditTimestamp ? new Date(data.auditTimestamp).toLocaleString() : "Not run yet"}</strong>
            </div>
            <div>
              Cache TTLs: <span style={{ color: "rgba(255,255,255,0.68)" }}>
                {Object.entries(data?.version.cacheTtlMinutes || {})
                  .map(([k, v]) => `${k} ${v}m`)
                  .join(" · ")}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
