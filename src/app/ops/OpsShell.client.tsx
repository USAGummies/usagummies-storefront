"use client";

import { useSession, signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import { ReactNode, useEffect, useState } from "react";
import { useIsMobile } from "@/app/ops/hooks";
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
  badge?: "pendingApprovals";
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
      { href: "/ops/abra", label: "Abra", icon: "\u{1F9E0}", roles: ["admin", "employee"] },
      { href: "/ops/digest", label: "Weekly Digest", icon: "\u{1F4CA}", roles: ["admin", "employee", "investor", "partner", "banker"] },
      { href: "/ops/competitors", label: "Competitive Intel", icon: "\u{1F3AF}", roles: ["admin", "employee"] },
      { href: "/ops", label: "Command Center", icon: "\u{1F3AF}", roles: ["admin", "employee", "investor", "partner", "banker"] },
      { href: "/ops/channels", label: "Revenue by Channel", icon: "\u{1F4CA}", roles: ["admin", "employee", "investor", "partner", "banker"] },
      { href: "/ops/permissions", label: "Permission Queue", icon: "\u{1F6E1}\uFE0F", roles: ["admin", "employee"] },
      { href: "/ops/approvals", label: "Approvals", icon: "\u2705", roles: ["admin", "employee"], badge: "pendingApprovals" },
      { href: "/ops/drafts", label: "Draft Emails", icon: "\u2709\uFE0F", roles: ["admin", "employee"] },
      { href: "/ops/documents", label: "Documents", icon: "\u{1F4C4}", roles: ["admin", "employee"] },
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
      { href: "/ops/departments/executive", label: "Executive Dept", icon: "\u{1F451}", roles: ["admin", "employee", "investor", "partner", "banker"] },
      { href: "/ops/departments/operations", label: "Operations Dept", icon: "\u2699\uFE0F", roles: ["admin", "employee", "investor", "partner"] },
      { href: "/ops/departments/finance", label: "Finance Dept", icon: "\u{1F4B8}", roles: ["admin", "employee", "investor", "partner", "banker"] },
      { href: "/ops/departments/sales_and_growth", label: "Sales & Growth Dept", icon: "\u{1F4C8}", roles: ["admin", "employee", "investor", "partner"] },
      { href: "/ops/departments/supply_chain", label: "Supply Chain Dept", icon: "\u{1F4E6}", roles: ["admin", "employee", "investor", "partner", "banker"] },
      { href: "/ops/agents", label: "Agents", icon: "\u{1F916}", roles: ["admin", "employee", "investor", "partner"] },
      { href: "/ops/inbox", label: "Inbox", icon: "\u{1F4E8}", roles: ["admin", "employee"] },
      { href: "/ops/logs", label: "Logs", icon: "\u{1F4DD}", roles: ["admin", "employee", "investor", "partner"] },
      { href: "/ops/wholesale", label: "Wholesale", icon: "\u{1F4E6}", roles: ["admin", "employee", "investor", "partner"] },
      { href: "/ops/settings", label: "Settings", icon: "\u2699\uFE0F", roles: ["admin"] },
    ],
  },
];

function OpsNav({
  isMobile,
  mobileNavOpen,
  onClose,
}: {
  isMobile: boolean;
  mobileNavOpen: boolean;
  onClose: () => void;
}) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [opsOpen, setOpsOpen] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  const role = session?.user?.role || "employee";

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function loadBadge() {
      try {
        const res = await fetch("/api/ops/abra/approvals?status=pending", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const count = typeof data?.count === "number" ? data.count : 0;
        setPendingApprovals(Math.max(0, count));
      } catch {
        // Best-effort
      }
    }

    if (role === "admin" || role === "employee") {
      void loadBadge();
      timer = setInterval(() => {
        void loadBadge();
      }, 60000);
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [role]);

  return (
    <nav
      style={{
        width: isMobile ? 260 : collapsed ? 60 : 240,
        minHeight: isMobile ? "100%" : "100vh",
        background: SIDEBAR_BG,
        borderRight: `1px solid ${SIDEBAR_BORDER}`,
        display: "flex",
        flexDirection: "column",
        transition: "transform 0.2s ease, width 0.2s ease",
        flexShrink: 0,
        position: isMobile ? "fixed" : "sticky",
        top: 0,
        left: isMobile ? 0 : undefined,
        bottom: isMobile ? 0 : undefined,
        alignSelf: isMobile ? undefined : "flex-start",
        zIndex: isMobile ? 1000 : 2,
        transform: isMobile
          ? mobileNavOpen
            ? "translateX(0)"
            : "translateX(-100%)"
          : "none",
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
        {isMobile ? (
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: TEXT_DIM,
              cursor: "pointer",
              fontSize: 20,
              padding: 2,
              lineHeight: 1,
            }}
            aria-label="Close sidebar"
          >
            ×
          </button>
        ) : (
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
        )}
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
                      {"\u25B6"}
                    </span>
                  )}
                </div>
              )}

              {/* Items */}
              {(isExpanded || collapsed) && visibleItems.map((item) => {
                const active = pathname === item.href || (item.href !== "/ops" && pathname.startsWith(item.href));
                const badgeCount =
                  item.badge === "pendingApprovals" ? pendingApprovals : 0;
                return (
                  <button
                    key={item.href}
                    onClick={() => {
                      router.push(item.href);
                      if (isMobile) onClose();
                    }}
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
                    {!collapsed && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span>{item.label}</span>
                        {badgeCount > 0 ? (
                          <span
                            style={{
                              minWidth: 18,
                              height: 18,
                              borderRadius: 999,
                              background: RED,
                              color: "#fff",
                              fontSize: 10,
                              fontWeight: 700,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: "0 5px",
                              lineHeight: 1,
                            }}
                          >
                            {badgeCount > 99 ? "99+" : badgeCount}
                          </span>
                        ) : null}
                      </span>
                    )}
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
  const isMobile = useIsMobile();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!isMobile) {
      setMobileNavOpen(false);
    }
  }, [isMobile]);

  const currentPageLabel = (() => {
    const flat = NAV_SECTIONS.flatMap((section) => section.items);
    const exact = flat.find((item) => item.href === pathname);
    if (exact) return exact.label;
    const prefix = flat.find(
      (item) => item.href !== "/ops" && pathname.startsWith(item.href),
    );
    return prefix?.label || "Command Center";
  })();

  if (pathname === "/ops/login") {
    return <>{children}</>;
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: BG_CREAM }}>
      {isMobile ? (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            height: 48,
            background: SIDEBAR_BG,
            borderBottom: `1px solid ${SIDEBAR_BORDER}`,
            zIndex: 999,
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            gap: 10,
          }}
        >
          <button
            onClick={() => setMobileNavOpen((open) => !open)}
            style={{
              border: "none",
              background: "transparent",
              color: "#fff",
              fontSize: 22,
              cursor: "pointer",
              lineHeight: 1,
              padding: 0,
            }}
            aria-label="Toggle navigation"
          >
            ☰
          </button>
          <span style={{ color: GOLD, fontSize: 13, fontWeight: 700 }}>
            {currentPageLabel}
          </span>
        </div>
      ) : null}

      {isMobile && mobileNavOpen ? (
        <div
          onClick={() => setMobileNavOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 998,
          }}
        />
      ) : null}

      <OpsNav
        isMobile={isMobile}
        mobileNavOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
      <main
        style={{
          flex: 1,
          padding: isMobile ? "64px 14px 16px" : "28px 36px",
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
