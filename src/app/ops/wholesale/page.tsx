import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wholesale",
};

export default function WholesalePage() {
  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, fontFamily: "var(--font-display)", margin: 0, marginBottom: 8 }}>
        Wholesale Orders
      </h1>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 32 }}>
        Create and manage wholesale orders.
      </p>
      <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "40px 32px", textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 14 }}>
        Coming soon — this page is under construction.
      </div>
    </div>
  );
}
