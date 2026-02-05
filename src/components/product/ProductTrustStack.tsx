// src/components/product/ProductTrustStack.tsx
import { PatriotRibbon } from "@/components/ui/PatriotRibbon";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";

export function ProductTrustStack() {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="kicker">Why people choose it</div>
      <div className="badge-row" style={{ marginTop: 10 }}>
        <span className="badge">Made in the USA</span>
        <span className="badge">No artificial dyes</span>
        <span className="badge">All natural flavors</span>
        <span className="badge">Ships fast</span>
      </div>

      <div style={{ marginTop: 10 }} className="muted">
        Bundle pricing is built in. Add more bags to lower the per-bag price and{" "}
        {FREE_SHIPPING_PHRASE}.
      </div>

      <div style={{ marginTop: 12 }}>
        <PatriotRibbon />
      </div>
    </div>
  );
}
