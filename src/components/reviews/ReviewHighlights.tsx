import { REVIEW_HIGHLIGHTS } from "@/data/reviewHighlights";
import { cn } from "@/lib/cn";

type Props = {
  variant?: "light" | "dark";
  limit?: number;
};

function stars(rating: number) {
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return "*".repeat(full).padEnd(5, "-");
}

export function ReviewHighlights({ variant = "dark", limit = 2 }: Props) {
  const list = REVIEW_HIGHLIGHTS.slice(0, Math.max(1, limit));
  const isDark = variant === "dark";

  return (
    <div
      className={cn(
        "rounded-2xl p-4",
        isDark
          ? "metal-panel border border-white/12 text-white"
          : "card-solid border border-[var(--border)] text-[var(--text)]"
      )}
    >
      <div className={cn("text-[11px] font-semibold uppercase tracking-[0.24em]", isDark ? "text-white/60" : "text-[var(--muted)]")}
      >
        Verified review highlights
      </div>
      <div className="mt-3 grid gap-3">
        {list.map((review) => (
          <div
            key={review.id}
            className={cn(
              "rounded-xl border px-3 py-2",
              isDark ? "border-white/10 bg-white/5" : "border-[var(--border)] bg-white"
            )}
          >
            <div className={cn("text-xs", isDark ? "text-white" : "text-[var(--text)]")}>
              {stars(review.rating)}
            </div>
            <div className={cn("mt-1 text-sm", isDark ? "text-white/80" : "text-[var(--muted)]")}>
              "{review.body}"
            </div>
            <div
              className={cn(
                "mt-2 text-xs font-semibold",
                isDark ? "text-white/70" : "text-[var(--text)]"
              )}
            >
              - {review.author}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
