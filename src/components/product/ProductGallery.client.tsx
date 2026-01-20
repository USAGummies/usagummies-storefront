"use client";

import * as React from "react";
import Image from "next/image";

type Img = {
  url: string;
  altText?: string | null;
  width?: number | null;
  height?: number | null;
};

function cn(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

function normalizeImages(featured?: Img | null, images?: Img[]) {
  const list: Img[] = [];
  if (featured?.url) list.push(featured);
  for (const im of images || []) {
    if (!im?.url) continue;
    if (!list.find((x) => x.url === im.url)) list.push(im);
  }
  return list;
}

export function ProductGallery({
  title,
  featured,
  images,
}: {
  title: string;
  featured?: Img | null;
  images?: Img[];
}) {
  const imgs = React.useMemo(
    () => normalizeImages(featured || null, images || []),
    [featured, images]
  );
  const [active, setActive] = React.useState(0);

  React.useEffect(() => {
    // When navigating between products in-app, reset to first image.
    setActive(0);
  }, [title]);

  const main = imgs[active] || imgs[0];

  return (
    <div className="glass-card overflow-hidden">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-[var(--surface)]">
        <Image
          src={main?.url || "/home-patriotic-product.jpg"}
          alt={main?.altText || title}
          fill
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-contain"
          priority={active === 0}
          fetchPriority={active === 0 ? "high" : "auto"}
        />
        {/* Subtle gold edge glow */}
        <div className="pointer-events-none absolute inset-0 ring-1 ring-[var(--border)] shadow-[0_0_60px_rgba(199,160,98,0.16)]" />
      </div>

      {imgs.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto border-t border-[var(--border)] bg-[var(--surface-strong)] p-3">
          {imgs.map((im, idx) => (
            <button
              key={im.url}
              type="button"
              onClick={() => setActive(idx)}
              className={cn(
                "relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border bg-[var(--surface)]",
                idx === active
                  ? "border-[rgba(199,160,98,0.6)] ring-1 ring-[rgba(199,160,98,0.3)]"
                  : "border-[var(--border)] hover:border-[rgba(13,28,51,0.2)]"
              )}
              aria-label={`View image ${idx + 1}`}
            >
              <Image
                src={im.url}
                alt={im.altText || title}
                fill
                sizes="64px"
                className="object-contain"
                priority={idx === 0}
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
