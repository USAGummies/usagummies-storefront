"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";

type Item = {
  id: string;
  caption?: string | null;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url: string;
  permalink?: string | null;
  thumbnail_url?: string | null;
};

type Feed = {
  items: Item[];
  source: "live" | "fallback";
  fetchedAt: string;
};

function cn(...s: Array<string | false | undefined | null>) {
  return s.filter(Boolean).join(" ");
}

export function InstagramGrid({
  username = "usagummies",
  limit = 12,
}: {
  username?: string;
  limit?: number;
}) {
  const [feed, setFeed] = React.useState<Feed | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;
    fetch(`/api/instagram?limit=${encodeURIComponent(String(limit))}`)
      .then((r) => r.json())
      .then((j) => {
        if (!mounted) return;
        setFeed(j);
      })
      .catch((e) => {
        if (!mounted) return;
        setErr(String(e?.message || "Failed to load Instagram"));
      });
    return () => {
      mounted = false;
    };
  }, [limit]);

  // Premium fallback: if no live feed, show a clean CTA only (no broken embed, no blank grid).
  const items = feed?.items || [];
  const showGrid = items.length > 0;

  return (
    <section className="glass p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs text-white/60">Follow the road trip</div>
          <h2 className="mt-1 text-xl font-semibold">
            @<span className="text-white">{username}</span>
          </h2>
          <div className="mt-2 text-sm text-white/70">
            Real America. Real gummies. No influencer nonsense.
          </div>
        </div>
        <Link
          href={`https://www.instagram.com/${username}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
        >
          Follow →
        </Link>
      </div>

      {err ? <div className="mt-4 text-xs text-white/50">{err}</div> : null}

      {showGrid ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {items.slice(0, limit).map((it) => {
            const href = it.permalink || `https://www.instagram.com/${username}/`;
            const src = it.media_type === "VIDEO" ? it.thumbnail_url || it.media_url : it.media_url;
            return (
              <a
                key={it.id}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "group relative aspect-square overflow-hidden rounded-2xl border border-white/10 bg-black/30",
                  "hover:border-[#d4af37]/25 hover:shadow-[0_0_0_1px_rgba(212,175,55,0.25),0_0_60px_rgba(212,175,55,0.08)]",
                  "transition"
                )}
              >
                <Image
                  src={src}
                  alt={it.caption?.slice(0, 80) || `@${username}`}
                  fill
                  sizes="(max-width: 1024px) 50vw, 16vw"
                  className="object-cover opacity-95 group-hover:opacity-100 group-hover:scale-[1.02] transition"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition" />
                {it.media_type === "VIDEO" ? (
                  <div className="absolute right-2 top-2 rounded-full border border-white/15 bg-black/40 px-2 py-0.5 text-[10px] text-white/80">
                    VIDEO
                  </div>
                ) : null}
              </a>
            );
          })}
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/70">
          Instagram feed will appear here once the Instagram API keys are added. Until then, the site stays fast and clean.
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-white/50">
        <div>
          {feed?.source === "live" ? "Live Instagram feed" : "Instagram feed not configured"}
        </div>
        <div>
          {feed?.fetchedAt ? `Updated: ${new Date(feed.fetchedAt).toLocaleString()}` : null}
        </div>
      </div>
    </section>
  );
}
