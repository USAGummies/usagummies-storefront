// src/components/chrome/SiteFooter.tsx
export function SiteFooter() {
  return (
    <footer style={{ padding: "40px 0 60px" }}>
      <div className="container">
        <div className="card" style={{ padding: 22 }}>
          <div className="h-eyebrow">Built in America. Shipped fast.</div>
          <div
            style={{
              marginTop: 10,
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ fontWeight: 800 }}>© {new Date().getFullYear()} USA Gummies</div>
            <div style={{ opacity: 0.75, fontSize: 13 }}>
              Policies • Shipping • Contact
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
