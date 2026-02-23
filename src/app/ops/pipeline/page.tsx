import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pipeline",
};

export default function PipelinePage() {
  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, fontFamily: "var(--font-display)", margin: 0, marginBottom: 8 }}>
        Sales Pipeline
      </h1>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 32 }}>
        B2B and distributor prospect pipeline from Notion.
      </p>
      <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "40px 32px", textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 14 }}>
        Coming soon — this page is under construction.
      </div>
    </div>
  );
}
