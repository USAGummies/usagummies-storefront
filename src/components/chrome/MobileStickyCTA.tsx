// src/components/chrome/MobileStickyCTA.tsx
import Link from "next/link";

export function MobileStickyCTA() {
  return (
    <div className="mobile-sticky-cta" role="region" aria-label="Quick actions">
      <div className="container" style={{ display: "flex", gap: 10 }}>
        <Link className="btn btn-primary" href="/shop" style={{ flex: 1 }}>
          Shop now
        </Link>
        <Link className="btn btn-navy" href="/cart">
          Cart
        </Link>
      </div>
    </div>
  );
}
