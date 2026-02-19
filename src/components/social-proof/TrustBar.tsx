const TRUST_ITEMS = [
  {
    icon: "🇺🇸",
    label: "Made in the USA",
    detail: "FDA-registered facility",
  },
  {
    icon: "🌿",
    label: "No artificial dyes",
    detail: "Colors from fruit & vegetable extracts",
  },
  {
    icon: "⭐",
    label: "4.8 stars",
    detail: "Verified buyer reviews",
  },
  {
    icon: "🚚",
    label: "Ships in 24h",
    detail: "Free shipping on 5+ bags",
  },
];

type TrustBarProps = {
  variant?: "full" | "compact";
  className?: string;
};

export function TrustBar({ variant = "full", className = "" }: TrustBarProps) {
  if (variant === "compact") {
    return (
      <div className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-[var(--muted,#5f5b56)] ${className}`}>
        {TRUST_ITEMS.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1">
            <span>{item.icon}</span>
            <span className="font-semibold text-[var(--text,#1B2A4A)]">{item.label}</span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border border-[var(--border,rgba(15,27,45,0.1))] bg-white p-4 ${className}`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TRUST_ITEMS.map((item) => (
          <div key={item.label} className="flex items-start gap-2">
            <span className="text-lg leading-none mt-0.5">{item.icon}</span>
            <div>
              <div className="text-xs font-bold text-[var(--text,#1B2A4A)]">{item.label}</div>
              <div className="text-[10px] text-[var(--muted,#5f5b56)] leading-tight">{item.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Inline social proof stat for use in hero sections or above CTAs.
 * Shows "Trusted by X+ Americans" with star rating.
 */
export function SocialProofStat({ className = "" }: { className?: string }) {
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border border-[rgba(15,27,45,0.08)] bg-white/90 backdrop-blur-sm px-4 py-2 text-xs ${className}`}>
      <span className="flex items-center gap-0.5 text-[var(--candy-yellow,#f5c842)]">
        {"★★★★★".split("").map((s, i) => (
          <span key={i}>{s}</span>
        ))}
      </span>
      <span className="font-semibold text-[var(--text,#1B2A4A)]">4.8</span>
      <span className="text-[var(--muted,#5f5b56)]">from verified buyers</span>
      <span className="mx-1 text-[var(--border)]">|</span>
      <span className="font-semibold text-[var(--text,#1B2A4A)]">Made in USA</span>
    </div>
  );
}

/**
 * Money-back guarantee badge for use near checkout CTAs.
 */
export function GuaranteeBadge({ className = "" }: { className?: string }) {
  return (
    <div className={`inline-flex items-center gap-2 rounded-xl border border-[rgba(45,122,58,0.2)] bg-[rgba(45,122,58,0.06)] px-3 py-2 ${className}`}>
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2D7A3A] text-white text-xs font-bold">✓</span>
      <div>
        <div className="text-xs font-bold text-[#2D7A3A]">Satisfaction Guaranteed</div>
        <div className="text-[10px] text-[var(--muted,#5f5b56)]">Love them or your money back</div>
      </div>
    </div>
  );
}
