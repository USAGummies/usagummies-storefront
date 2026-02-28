"use client";

import { useSession, signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import { ReactNode, useState } from "react";
import {
  NAVY,
  RED,
  GOLD,
  CREAM as BG_CREAM,
  SIDEBAR_BG,
  SIDEBAR_BORDER,
  TEXT_DIM,
  TEXT_MED,
} from "@/app/ops/tokens";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  roles: string[];
};

type NavSection = {
  title: string;
  items: NavItem[];
  collapsible?: boolean;
};

const NAV_SECTIONS: NavSection[] = [
  {
    title: "COMMAND",
    items: [
      { href: "/ops", label: "Command Center", icon: "\u{1F3DB}\uFE0F", roles: ["admin", "employee", "investor", "partner", "banker"] },
      { href: "/ops/channels", label: "Revenue by Channel", icon: "\u{1F4CA}", roles: ["admin", "employee", "investor", "partner", "banker"] },
      { href: "/ops/finance", label: "P&L / Finance", icon: "\u{1F4B5}", roles: ["admin", "investor", "partner", "banker"] },
      { href: "/ops/forecast", label: "Cash Forecast", icon: "\u{1F52E}", roles: ["admin", "investor", "partner", "banker"] },
      { href: "/ops/pipeline", label: "Pipeline & Deals", icon: "\u{1F30E}", roles: ["admin", "employee", "investor", "partner"] },
      { href: "/ops/supply-chain", label: "Supply Chain", icon: "\u{1F69A}", roles: ["admin", "employee", "investor", "partner", "banker"] },
      { href: "/ops/marketing", label: "Marketing & ROAS", icon: "\u{1F4E3}", roles: ["admin", "employee", "investor", "partner", "banker"] },
      { href: "/ops/kpis", label: "KPIs & Milestones", icon: "\u{1F3AF}", roles: ["admin", "employee", "investor", "partner", "banker"] },
    ],
  },
  {
    title: "OPERATIONS",
    collapsible: true,
    items: [
      { href: "/ops/agents", label: "Agents", icon: "\u{1F916}", roles: ["admin", "employee", "investor", "partner"] },
      { href: "/ops/inbox", label: "Inbox", icon: "\u{1F4E8}", roles: ["admin", "employee"] },
      { href: "/ops/logs", label: "Logs", icon: "\u{1F4DD}", roles: ["admin", "employee", "investor", "partner"] },
      { href: "/ops/wholesale", label: "Wholesale", icon: "\u{1F4E6}", roles: ["admin", "employee", "investor", "partner"] },
      { href: "/ops/settings", label: "Settings", icon: "\u2699\uFE0F", roles: ["admin"] },
    ],
  },
];

function OpsNav() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [opsOpen, setOpsOpen] = useState(false);

  const role = session?.user?.role || "employee";

  return (
    <nav
      style={{
        width: collapsed ? 60 : 240,
        minHeight: "100vh",
        background: SIDEBAR_BG,
        borderRight: `1px solid ${SIDEBAR_BORDER}`,
        display: "flex",
        flexDirection: "column",
        transition: "width 0.2s ease",
        flexShrink: 0,
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
      }}
    >
      {/* ── Logo ──────────────────────────────────────── */}
      <div
        style={{
          padding: collapsed ? "20px 10px" : "20px 18px",
          borderBottom: `1px solid ${SIDEBAR_BORDER}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: 68,
        }}
      >
        {!collapsed && (
          <div>
            <div style={{
              fontWeight: 800,
              color: "#fff",
              fontSize: 15,
              fontFamily: "var(--font-display)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}>
              USA Gummies
            </div>
            <div style={{
              fontSize: 9,
              color: GOLD,
              textTransform: "uppercase",
              letterSpacing: "0.18em",
              fontWeight: 700,
              marginTop: 2,
            }}>
              War Room
            </div>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            background: "none",
            border: "none",
            color: TEXT_DIM,
            cursor: "pointer",
            fontSize: 14,
            padding: 4,
          }}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "\u25B6" : "\u25C0"}
        </button>
      </div>

      {/* ── Nav Sections ──────────────────────────────── */}
      <div style={{ flex: 1, padding: "8px 0", overflowY: "auto" }}>
        {NAV_SECTIONS.map((section) => {
          const visibleItems = section.items.filter((item) => item.roles.includes(role));
          if (visibleItems.length === 0) return null;

          const isOpsSection = section.collapsible;
          const isExpanded = isOpsSection ? opsOpen : true;

          return (
            <div key={section.title} style={{ marginBottom: 4 }}>
              {/* Section header */}
              {!collapsed && (
                <div
                  onClick={isOpsSection ? () => setOpsOpen(!opsOpen) : undefined}
                  style={{
                    padding: "10px 18px 4px",
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.14em",
                    color: isOpsSection ? TEXT_DIM : GOLD,
                    textTransform: "uppercase",
                    cursor: isOpsSection ? "pointer" : "default",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    userSelect: "none",
                  }}
                >
                  <span>{section.title}</span>
                  {isOpsSection && (
                    <span style={{ fontSize: 8, transition: "transform 0.15s", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>
                      \u25B6
                    </span>
                  )}
                </div>
              )}

              {/* Items */}
              {(isExpanded || collapsed) && visibleItems.map((item) => {
                const active = pathname === item.href || (item.href !== "/ops" && pathname.startsWith(item.href));
                return (
                  <button
                    key={item.href}
                    onClick={() => router.push(item.href)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: collapsed ? "9px 0" : "9px 18px",
                      justifyContent: collapsed ? "center" : "flex-start",
                      background: active ? `rgba(199,54,44,0.12)` : "transparent",
                      borderLeft: "none",
                      borderRight: "none",
                      borderTop: "none",
                      borderBottom: "none",
                      borderLeftWidth: 3,
                      borderLeftStyle: "solid",
                      borderLeftColor: active ? RED : "transparent",
                      color: active ? "#fff" : TEXT_MED,
                      fontSize: 13,
                      fontWeight: active ? 600 : 400,
                      cursor: "pointer",
                      transition: "all 0.15s",
                      textAlign: "left",
                      fontFamily: "inherit",
                    }}
                  >
                    <span style={{ fontSize: 15 }}>{item.icon}</span>
                    {!collapsed && item.label}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* ── User Section ──────────────────────────────── */}
      <div
        style={{
          padding: collapsed ? "14px 8px" : "14px 18px",
          borderTop: `1px solid ${SIDEBAR_BORDER}`,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {!collapsed && session?.user && (
          <div style={{ fontSize: 12, color: TEXT_DIM }}>
            <div style={{ fontWeight: 600, color: TEXT_MED }}>{session.user.name}</div>
            <div style={{ textTransform: "capitalize", fontSize: 10 }}>{session.user.role}</div>
          </div>
        )}
        <button
          onClick={() => signOut({ callbackUrl: "/ops/login" })}
          style={{
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${SIDEBAR_BORDER}`,
            borderRadius: 6,
            color: TEXT_DIM,
            fontSize: 11,
            padding: "6px 10px",
            cursor: "pointer",
            fontFamily: "inherit",
            textAlign: "center",
          }}
        >
          {collapsed ? "\u{1F6AA}" : "Sign Out"}
        </button>
      </div>
    </nav>
  );
}

function OpsContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/ops/login") {
    return <>{children}</>;
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: BG_CREAM }}>
      <OpsNav />
      <main
        style={{
          flex: 1,
          padding: "28px 36px",
          color: NAVY,
          fontFamily: "var(--font-sans), system-ui, sans-serif",
          overflowX: "hidden",
          minWidth: 0,
        }}
      >
        {children}
      </main>
    </div>
  );
}

export function OpsShell({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <OpsContent>{children}</OpsContent>
    </SessionProvider>
  );
}
