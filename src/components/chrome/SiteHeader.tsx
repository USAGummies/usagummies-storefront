// src/components/chrome/SiteHeader.tsx
import Link from "next/link";

export function SiteHeader() {
  return (
    <header style={{ position: "sticky", top: 0, zIndex: 30 }}>
      <div
        style={{
          background: "rgba(255,247,234,0.82)",
          backdropFilter: "blur(10px)",
          borderBottom: "1px solid rgba(0,0,0,0.08)",
        }}
      >
        <div className="container" style={{ padding: "10px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Link
              href="/"
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                textDecoration: "none",
                color: "var(--ink)",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  textTransform: "uppercase",
                  fontWeight: 900,
                  letterSpacing: "-0.02em",
                  fontSize: 18,
                }}
              >
                USA Gummies
              </span>
              <span className="chip">
                <span>🇺🇸</span>
                <span>American-Made</span>
              </span>
            </Link>

            <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
              <Link className="btn" href="/shop">
                Shop now and save
              </Link>
              <Link className="btn btn-navy" href="/cart">
                Cart
              </Link>
            </div>
          </div>

          <div style={{ marginTop: 10 }} className="rule" />
        </div>
      </div>
    </header>
  );
}
