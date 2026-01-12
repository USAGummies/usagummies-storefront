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

const FALLBACK_IMAGES = [
  "/home-patriotic-product.jpg",
  "/brand/hero.jpg",
  "/hero.jpg",
  "/america-250.jpg",
  "/logo.jpg",
  "/brand/hero.jpg",
  "/home-patriotic-product.jpg",
  "/hero.jpg",
  "/america-250.jpg",
  "/logo.jpg",
  "/brand/hero.jpg",
  "/home-patriotic-product.jpg",
];

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
  const fallbackItems: Item[] = FALLBACK_IMAGES.map((src) => ({
    id: `fallback-${src}`,
    caption: "USA Gummies",
    media_type: "IMAGE",
    media_url: src,
    permalink: `https://www.instagram.com/${username}/`,
  }));
  const displayItems = items.length ? items : fallbackItems;
  const showGrid = displayItems.length > 0;
  const usingFallback = items.length === 0;

  return (
    <section className="metal-panel rounded-[32px] border border-[rgba(199,54,44,0.3)] p-5 text-white sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
            Made in the USA
          </div>
          <h2 className="mt-1 text-2xl font-black text-white">
            @{username}
          </h2>
          <div className="mt-2 text-sm text-white/70">
            No artificial dyes or synthetic colors. Classic gummy bear flavor — done right.
          </div>
        </div>
        <Link
          href={`https://www.instagram.com/${username}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-outline-white"
        >
          Follow →
        </Link>
      </div>

      {err ? (
        <div className="mt-4 text-xs text-white/60">
          Showing a preview while the live feed refreshes.
        </div>
      ) : null}

      {showGrid ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {displayItems.slice(0, limit).map((it) => {
            const href = it.permalink || `https://www.instagram.com/${username}/`;
            const src = it.media_type === "VIDEO" ? it.thumbnail_url || it.media_url : it.media_url;
            return (
              <a
                key={it.id}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "group relative aspect-square overflow-hidden rounded-2xl border border-white/10 bg-white/5",
                  "hover:border-white/30 hover:shadow-[0_18px_42px_rgba(5,10,20,0.45)]",
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
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition" />
                {it.media_type === "VIDEO" ? (
                  <div className="absolute right-2 top-2 rounded-full border border-white/15 bg-[rgba(13,28,51,0.85)] px-2 py-0.5 text-[10px] text-white/90">
                    VIDEO
                  </div>
                ) : null}
              </a>
            );
          })}
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
          Follow @usagummies for the latest drops, customer photos, and bundle moments.
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-white/60">
        <div>
          {feed?.source === "live" ? "Live Instagram feed" : "Instagram preview"}
        </div>
        <div>
          {feed?.fetchedAt && !usingFallback
            ? `Updated: ${new Date(feed.fetchedAt).toLocaleString()}`
            : null}
        </div>
      </div>
    </section>
  );
}
