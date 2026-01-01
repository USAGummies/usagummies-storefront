import { getAmazonHighlights } from "@/lib/reviews";

export function ReviewHighlights({ limit = 3 }: { limit?: number }) {
  const items: any[] = getAmazonHighlights(limit);
  if (!items.length) return null;
  return (
    <div className="mt-4 grid gap-3">
      {items.map((r) => (
        <div key={r.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-sm font-semibold text-white">⭐ {r.stars} / 5</div>
          {r.title ? <div className="mt-2 text-sm font-semibold text-white">{r.title}</div> : null}
          <div className="mt-2 text-sm text-white/75">{r.body}</div>
        </div>
      ))}
    </div>
  );
}
