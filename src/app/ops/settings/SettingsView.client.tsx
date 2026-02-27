"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

const CARD_STYLE: React.CSSProperties = {
  background: "#1a1d27",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 12,
};

export function SettingsView() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});

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

  const integrationRows = useMemo(() => {
    if (!data) return [];
    return [
      ["Shopify", data.integrations.shopify],
      ["Plaid", data.integrations.plaid],
      ["GA4", data.integrations.ga4],
      ["Gmail", data.integrations.gmail],
      ["Notion", data.integrations.notion],
      ["Amazon", data.integrations.amazon],
      ["Slack", data.integrations.slack],
    ] as const;
  }, [data]);

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
            {integrationRows.map(([name, ok]) => (
              <div key={name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "rgba(255,255,255,0.82)" }}>{name}</span>
                <span style={{ color: ok ? "#4ade80" : "#f87171", fontWeight: 700 }}>
                  {ok ? "\u2713 Configured" : "\u2717 Missing"}
                </span>
              </div>
            ))}
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
