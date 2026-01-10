// src/components/product/ProductTrustStack.tsx
import { PatriotRibbon } from "@/components/ui/PatriotRibbon";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";

export function ProductTrustStack() {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="kicker">Why this converts</div>
      <div className="badge-row" style={{ marginTop: 10 }}>
        <span className="badge">🇺🇸 Made in USA</span>
        <span className="badge">✅ Dye-free</span>
        <span className="badge">🍓 All natural flavors</span>
        <span className="badge">🚚 Ships fast</span>
      </div>

      <div style={{ marginTop: 10 }} className="muted">
        Bundle pricing is built into every product page. Add more bags to unlock
        better value and {FREE_SHIPPING_PHRASE.toLowerCase()}.
      </div>

      <div style={{ marginTop: 12 }}>
        <PatriotRibbon />
      </div>
    </div>
  );
}
