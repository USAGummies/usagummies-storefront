"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

type SummaryData = {
  overall: string;
  counts: { healthy: number; warning: number; critical: number; unknown: number };
  agentCount: number;
  lastUpdated: string;
};

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div
      style={{
        background: "#1a1d27",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 12,
        padding: "20px 24px",
        minWidth: 160,
        flex: "1 1 160px",
      }}
    >
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color, fontFamily: "var(--font-display)" }}>
        {value}
      </div>
    </div>
  );
}

export function OpsDashboard() {
  const { data: session } = useSession();
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function fetchSummary() {
      try {
        const res = await fetch("/api/agentic/command-center", { cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setSummary({
            overall: data.overall || "unknown",
            counts: data.counts || { healthy: 0, warning: 0, critical: 0, unknown: 0 },
            agentCount: data.agents?.length || 0,
            lastUpdated: data.generatedAtET || "",
          });
        }
      } catch {
        if (!cancelled) setError("Failed to load agent status");
      }
    }

    fetchSummary();
    const interval = setInterval(fetchSummary, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const greeting = session?.user?.name
    ? `Welcome back, ${session.user.name.split(" ")[0]}`
    : "Welcome";

  const overallColor =
    summary?.overall === "healthy" ? "#43c46b" : summary?.overall === "warning" ? "#ff9f43" : summary?.overall === "critical" ? "#ef3b3b" : "rgba(255,255,255,0.4)";

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 700,
            fontFamily: "var(--font-display)",
            margin: 0,
            letterSpacing: "0.01em",
          }}
        >
          {greeting}
        </h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 6 }}>
          USA Gummies Operations Platform
          {summary?.lastUpdated ? ` \u2014 Last sync: ${summary.lastUpdated} ET` : ""}
        </p>
      </div>

      {error && (
        <div
          style={{
            background: "rgba(220,38,38,0.1)",
            border: "1px solid rgba(220,38,38,0.2)",
            borderRadius: 8,
            padding: "12px 16px",
            marginBottom: 24,
            color: "#ef4444",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* System Health Cards */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.55)", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          System Health
        </h2>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <StatCard label="Overall Status" value={summary?.overall || "Loading..."} color={overallColor} />
          <StatCard label="Healthy Agents" value={summary?.counts.healthy ?? "-"} color="#43c46b" />
          <StatCard label="Warnings" value={summary?.counts.warning ?? "-"} color="#ff9f43" />
          <StatCard label="Critical" value={summary?.counts.critical ?? "-"} color="#ef3b3b" />
          <StatCard label="Total Agents" value={summary?.agentCount ?? "-"} color="rgba(255,255,255,0.7)" />
        </div>
      </div>

      {/* Quick Links */}
      <div>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.55)", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Quick Actions
        </h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {[
            { href: "/ops/agents", label: "View All Agents", icon: "\u{1F916}" },
            { href: "/ops/inbox", label: "Reply Queue", icon: "\u{1F4E8}" },
            { href: "/ops/pipeline", label: "Pipeline", icon: "\u{1F4C8}" },
            { href: "/ops/wholesale", label: "New Wholesale Order", icon: "\u{1F4E6}" },
          ].map((link) => (
            <a
              key={link.href}
              href={link.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 18px",
                background: "#1a1d27",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 10,
                color: "rgba(255,255,255,0.7)",
                textDecoration: "none",
                fontSize: 13,
                fontWeight: 500,
                transition: "border-color 0.15s",
              }}
            >
              <span style={{ fontSize: 18 }}>{link.icon}</span>
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
