import { getAmazonHighlights } from "@/lib/reviews";

export function ReviewHighlights({ limit = 3 }: { limit?: number }) {
  const items: any[] = getAmazonHighlights(limit);
  if (!items.length) return null;
  return (
    <div className="mt-4 grid gap-3">
      {items.map((r) => (
        <div key={r.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_12px_28px_rgba(15,27,45,0.12)]">
          <div className="text-sm font-semibold text-[var(--text)]">⭐ {r.stars} / 5</div>
          {r.title ? <div className="mt-2 text-sm font-semibold text-[var(--text)]">{r.title}</div> : null}
          <div className="mt-2 text-sm text-[var(--muted)]">{r.body}</div>
        </div>
      ))}
    </div>
  );
}
