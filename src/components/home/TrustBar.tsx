// src/components/home/TrustBar.tsx
export function TrustBar() {
  const items = [
    { t: "American-Made", d: "Built with pride. No fluff." },
    { t: "Fast Shipping", d: "Quick fulfillment & tracking." },
    { t: "Secure Checkout", d: "Shopify checkout protection." },
    { t: "Buy More, Save More", d: "Bigger cart = better deal." },
  ];

  return (
    <div className="grid gap-2.5 p-3.5 rounded-2xl border border-[rgba(15,27,45,0.08)] bg-white/60 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((x) => (
        <div
          key={x.t}
          className="rounded-xl border border-[rgba(0,0,0,0.07)] bg-white/70 p-3"
        >
          <div className="font-black text-sm">{x.t}</div>
          <div className="mt-1 text-[13px] opacity-75">{x.d}</div>
        </div>
      ))}
    </div>
  );
}
