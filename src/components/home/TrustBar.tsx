// src/components/home/TrustBar.tsx
export function TrustBar() {
  const items = [
    { t: "American-Made", d: "Built with pride. No fluff." },
    { t: "Fast Shipping", d: "Quick fulfillment & tracking." },
    { t: "Secure Checkout", d: "Shopify checkout protection." },
    { t: "Buy More, Save More", d: "Bigger cart = better deal." },
  ];

  return (
    <div
      className="card"
      style={{
        padding: 14,
        display: "grid",
        gap: 10,
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
      }}
    >
      {items.map((x) => (
        <div
          key={x.t}
          style={{
            padding: 12,
            borderRadius: 14,
            border: "1px solid rgba(0,0,0,0.07)",
            background: "rgba(255,255,255,0.70)",
          }}
        >
          <div style={{ fontWeight: 900 }}>{x.t}</div>
          <div style={{ opacity: 0.75, fontSize: 13, marginTop: 4 }}>
            {x.d}
          </div>
        </div>
      ))}

      <style>{`
        @media (max-width: 980px){
          div.card{ grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 520px){
          div.card{ grid-template-columns: repeat(1, minmax(0, 1fr)) !important; }
        }
      `}</style>
    </div>
  );
}
