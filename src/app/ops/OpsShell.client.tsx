"use client";

import { useSession, signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import { ReactNode, useState } from "react";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  roles: string[];
};

const NAV_ITEMS: NavItem[] = [
  { href: "/ops", label: "Dashboard", icon: "\u{1F4CA}", roles: ["admin", "employee", "investor"] },
  { href: "/ops/agents", label: "Agents", icon: "\u{1F916}", roles: ["admin", "employee", "investor"] },
  { href: "/ops/inbox", label: "Inbox", icon: "\u{1F4E8}", roles: ["admin", "employee"] },
  { href: "/ops/pipeline", label: "Pipeline", icon: "\u{1F4C8}", roles: ["admin", "employee"] },
  { href: "/ops/wholesale", label: "Wholesale", icon: "\u{1F4E6}", roles: ["admin", "employee", "partner"] },
  { href: "/ops/kpis", label: "KPIs", icon: "\u{1F3AF}", roles: ["admin", "employee", "investor"] },
  { href: "/ops/finance", label: "Finance", icon: "\u{1F4B0}", roles: ["admin", "investor"] },
  { href: "/ops/logs", label: "Logs", icon: "\u{1F4DD}", roles: ["admin", "employee"] },
  { href: "/ops/settings", label: "Settings", icon: "\u2699\uFE0F", roles: ["admin"] },
];

function OpsNav() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  const role = session?.user?.role || "employee";
  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(role));

  return (
    <nav
      style={{
        width: collapsed ? 60 : 220,
        minHeight: "100vh",
        background: "#12141c",
        borderRight: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        flexDirection: "column",
        transition: "width 0.2s ease",
        flexShrink: 0,
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
      }}
    >
      {/* Logo area */}
      <div
        style={{
          padding: collapsed ? "20px 10px" : "20px 18px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: 64,
        }}
      >
        {!collapsed && (
          <div>
            <div style={{ fontWeight: 700, color: "#fff", fontSize: 16, fontFamily: "var(--font-display)" }}>
              USA Gummies
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              OPS
            </div>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.35)",
            cursor: "pointer",
            fontSize: 16,
            padding: 4,
          }}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "\u25B6" : "\u25C0"}
        </button>
      </div>

      {/* Nav items */}
      <div style={{ flex: 1, padding: "12px 0" }}>
        {visibleItems.map((item) => {
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
                padding: collapsed ? "10px 0" : "10px 18px",
                justifyContent: collapsed ? "center" : "flex-start",
                background: active ? "rgba(199,54,44,0.15)" : "transparent",
                borderLeft: active ? "3px solid #c7362c" : "3px solid transparent",
                border: "none",
                borderLeftWidth: 3,
                borderLeftStyle: "solid",
                borderLeftColor: active ? "#c7362c" : "transparent",
                color: active ? "#fff" : "rgba(255,255,255,0.55)",
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                cursor: "pointer",
                transition: "all 0.15s",
                textAlign: "left",
                fontFamily: "inherit",
              }}
            >
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              {!collapsed && item.label}
            </button>
          );
        })}
      </div>

      {/* User section */}
      <div
        style={{
          padding: collapsed ? "14px 8px" : "14px 18px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {!collapsed && session?.user && (
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
            <div style={{ fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{session.user.name}</div>
            <div style={{ textTransform: "capitalize" }}>{session.user.role}</div>
          </div>
        )}
        <button
          onClick={() => signOut({ callbackUrl: "/ops/login" })}
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 6,
            color: "rgba(255,255,255,0.45)",
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

  // Login page gets rendered without the shell
  if (pathname === "/ops/login") {
    return <>{children}</>;
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0f1117" }}>
      <OpsNav />
      <main
        style={{
          flex: 1,
          padding: "28px 32px",
          color: "#fff",
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
