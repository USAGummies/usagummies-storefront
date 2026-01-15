import Link from "next/link";

type Variant = "full" | "compact";

type Props = {
  variant?: Variant;
  className?: string;
  ctaHref?: string;
  ctaLabel?: string;
  showJoinButton?: boolean;
  tone?: "dark" | "light";
};

const STORY_HOOK =
  "Every bag supports American manufacturing and American jobs. The American Dream is something to always strive for and try to achieve.";

const STORY_LINES = [
  "Sourced, made, and packed right here in the USA! Our gummies are a symbol of strength, grit, and the unstoppable American spirit.",
  "When you choose USA Gummies, you're backing American jobs, American business, and the star-spangled pursuit of greatness! Because in America, dreams do come true!",
  "Every bite is a thunderous cheer for the American spirit, a heartfelt salute to the tireless workers, dreamers, and doers who drive this great nation's heartbeat.",
  "So snag a handful of these freedom-packed gummies, savor the taste of freedom, and awaken the unstoppable spirit of your own American Dream!",
];

function Star() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2.5 14.9 8l6.1.9-4.4 4.3 1 6.1L12 16.9 6.4 19.3l1-6.1-4.4-4.3L9.1 8z"
      />
    </svg>
  );
}

export function AmericanDreamCallout({
  variant = "full",
  className,
  ctaHref,
  ctaLabel,
  showJoinButton = true,
  tone = "dark",
}: Props) {
  const paragraphs = variant === "full" ? STORY_LINES : STORY_LINES.slice(0, 2);
  const isLight = tone === "light";

  return (
    <div
      className={[
        "relative overflow-hidden rounded-[32px] border p-5 sm:p-6",
        isLight
          ? "border-[rgba(15,27,45,0.12)] bg-white text-[var(--text)] shadow-[0_18px_40px_rgba(15,27,45,0.12)]"
          : "border-[rgba(199,160,98,0.45)] bg-[rgba(8,16,30,0.88)] text-white shadow-[0_24px_70px_rgba(7,12,20,0.5)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          backgroundImage: isLight
            ? "radial-gradient(circle at 15% 10%, rgba(255,77,79,0.08), transparent 50%), radial-gradient(circle at 88% 0%, rgba(255,199,44,0.12), transparent 45%)"
            : "radial-gradient(circle at 15% 10%, rgba(255,255,255,0.12), transparent 50%), radial-gradient(circle at 88% 0%, rgba(199,160,98,0.18), transparent 45%), repeating-linear-gradient(120deg, rgba(255,255,255,0.04) 0 2px, rgba(0,0,0,0.03) 2px 4px)",
          opacity: isLight ? 0.6 : 0.7,
        }}
      />

      <div className="relative space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className={isLight ? "flex items-center gap-1 text-[var(--candy-yellow)]" : "flex items-center gap-1 text-[var(--gold)]"}>
            {Array.from({ length: 5 }).map((_, idx) => (
              <Star key={idx} />
            ))}
          </div>
          <div className={isLight ? "text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]" : "text-[10px] font-semibold uppercase tracking-[0.3em] text-white/70"}>
            Our story
          </div>
        </div>

        <div className="space-y-1">
          <div className={isLight ? "text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]" : "text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60"}>
            This is the
          </div>
          <div className={isLight ? "text-2xl font-black text-[var(--text)] sm:text-3xl" : "text-2xl font-black text-white sm:text-3xl"}>
            United States of America
          </div>
          <div className={isLight ? "text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]" : "text-xs font-semibold uppercase tracking-[0.2em] text-white/70"}>
            Land of the free, home of the brave
          </div>
        </div>

        <div
          className={
            isLight
              ? "rounded-2xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] p-4 text-sm text-[var(--text)]"
              : "rounded-2xl border border-[rgba(199,160,98,0.4)] bg-[rgba(12,20,38,0.8)] p-4 text-sm text-white/85"
          }
        >
          {STORY_HOOK}
        </div>

        <div className={isLight ? "space-y-3 text-sm text-[var(--muted)]" : "space-y-3 text-sm text-white/75"}>
          {paragraphs.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {showJoinButton ? (
            <Link href="/join-the-revolution" className={isLight ? "btn btn-outline" : "btn btn-outline-white"}>
              Join the Revolution
            </Link>
          ) : null}
          {ctaHref && ctaLabel ? (
            <Link href={ctaHref} className={isLight ? "btn btn-candy" : "btn btn-red"}>
              {ctaLabel}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
