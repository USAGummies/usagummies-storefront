import { AMAZON_REVIEWS } from "@/data/amazonReviews";
import { REVIEW_HIGHLIGHTS } from "@/data/reviewHighlights";

type Tone = "dark" | "light";
type Surface = "card" | "flat";
type Layout = "classic" | "integrated" | "fusion";
type Variant = "default" | "compact";

function starLine(rating: number) {
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(full).padEnd(5, "☆");
}

export function BundleQuickBuyRailProof({ tone = "dark" }: { tone?: Tone }) {
  const isLight = tone === "light";
  return (
    <>
      <div
        data-rail-trust
        className={[
          "flex flex-wrap items-center gap-3 text-[12px] font-semibold",
          isLight ? "text-[#6B6B6B]" : "text-white/70",
        ].join(" ")}
      >
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true">🚚</span>
          <span>Fast, reliable shipping</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true">✅</span>
          <span>Satisfaction guaranteed</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true">🔒</span>
          <span>Secure checkout</span>
        </span>
      </div>
      <div className="bundle-quickbuy__rating">
        <div className="bundle-quickbuy__ratingLine">
          <span className="bundle-quickbuy__ratingStars">
            {starLine(AMAZON_REVIEWS.aggregate.rating)}
          </span>
          <span>
            {AMAZON_REVIEWS.aggregate.rating.toFixed(1)} stars from verified Amazon buyers
          </span>
        </div>
      </div>
    </>
  );
}

type CtaProofProps = {
  tone?: Tone;
  surface?: Surface;
  layout?: Layout;
  variant?: Variant;
};

export function BundleQuickBuyCtaProof({
  tone = "dark",
  surface = "card",
  layout = "classic",
  variant = "default",
}: CtaProofProps) {
  const isLight = tone === "light";
  const isCompact = variant === "compact";
  const isFlat = surface === "flat";
  const isFusion = layout === "fusion";
  const reviewSnippets = REVIEW_HIGHLIGHTS.slice(0, 2);

  return (
    <>
      <div data-bundle-cta-trust>
        <div
          data-bundle-cta-note
          className={[
            isLight
              ? "text-xs text-[var(--muted)]"
              : isCompact
                ? "text-xs text-white/70"
                : "text-xs text-white/75",
            isFusion ? "bundle-fusion__ctaNote" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          🇺🇸 Made in the USA • ✅ Satisfaction guaranteed • 🚚 Fast, reliable shipping • 🔒 Secure checkout
        </div>
        <div
          data-bundle-rating
          className={[
            isFlat
              ? isLight
                ? "mt-2 text-[11px] text-[var(--muted)]"
                : "mt-2 text-[11px] text-white/70"
              : isLight
                ? "mt-2 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white px-3 py-2 text-[11px] text-[var(--muted)]"
                : "mt-2 rounded-2xl border border-white/12 bg-white/5 px-3 py-2 text-[11px] text-white/70",
            isFusion ? "bundle-fusion__ctaProof" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div className={isLight ? "font-semibold text-[var(--text)]" : "font-semibold text-white/90"}>
            {AMAZON_REVIEWS.aggregate.rating.toFixed(1)} stars from verified Amazon buyers
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.12em]">
            <span
              className={
                isFlat
                  ? "px-0 py-0"
                  : isLight
                    ? "rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-2 py-1"
                    : "rounded-full border border-white/10 bg-white/5 px-2 py-1"
              }
            >
              🇺🇸 Made in the USA
            </span>
            <span
              className={
                isFlat
                  ? "px-0 py-0"
                  : isLight
                    ? "rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-2 py-1"
                    : "rounded-full border border-white/10 bg-white/5 px-2 py-1"
              }
            >
              🌿 No artificial dyes
            </span>
          </div>
        </div>
      </div>
      {!isFusion && reviewSnippets.length ? (
        <div
          data-bundle-reviews
          className={isLight ? "grid gap-1 text-[11px] text-[var(--muted)]" : "grid gap-1 text-[11px] text-white/70"}
        >
          {reviewSnippets.map((review) => (
            <div key={review.id} className="inline-flex items-center gap-2">
              <span className={isLight ? "text-[var(--candy-yellow)]" : "text-[var(--gold)]"}>
                {starLine(review.rating)}
              </span>
              <span className="truncate">&quot;{review.body}&quot; — {review.author}</span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
