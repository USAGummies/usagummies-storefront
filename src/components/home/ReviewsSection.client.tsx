"use client";

import React from "react";
import Image from "next/image";

export type ReviewSource = "legacy" | "shopify";

export type Review = {
  id: string;
  source: ReviewSource;
  rating: number;
  title?: string;
  body: string;
  authorName: string;
  dateISO?: string;
  productLabel?: string;
  verified: boolean;
  helpfulCount?: number;
  featured?: boolean;
};

type Props = {
  reviews: Review[];
};

type Mention = { key: string; label: string; keywords: string[]; count: number };

const MENTION_PRESETS: Mention[] = [
  { key: "flavor", label: "Bold flavor", keywords: ["flavor", "taste"], count: 0 },
  { key: "aftertaste", label: "No weird aftertaste", keywords: ["aftertaste"], count: 0 },
  { key: "dye", label: "Dye-free", keywords: ["dye", "artificial"], count: 0 },
  { key: "texture", label: "Great texture", keywords: ["texture", "chew", "chewy"], count: 0 },
  { key: "usa", label: "Made in USA", keywords: ["usa", "american"], count: 0 },
  { key: "gift", label: "Giftable", keywords: ["gift"], count: 0 },
];

const CTA_LINK =
  "/products/all-american-gummy-bears-7-5-oz-single-bag?focus=bundles&bundle=5";

const MAX_SUPPORTING = 8;


function clsx(...a: Array<string | false | null | undefined>) {
  return a.filter(Boolean).join(" ");
}

function formatDate(dateISO?: string) {
  if (!dateISO) return "";
  const d = new Date(dateISO);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function initials(name: string) {
  return (name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
}

function Stars({ rating, size = "sm" }: { rating: number; size?: "sm" | "md" }) {
  const full = Math.round(rating);
  return (
    <div
      className={clsx(
        "flex items-center gap-1 text-amber-300",
        size === "md" ? "text-base" : "text-sm"
      )}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className="text-sm">
          {i < full ? "★" : "☆"}
        </span>
      ))}
    </div>
  );
}

function VerifiedBadge({ source }: { source: ReviewSource }) {
  if (source === "shopify") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold text-white/85">
        Shopify • Verified buyer
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold text-white/80">
      Verified buyer (prior store)
    </span>
  );
}

function StarFieldOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.12]"
      style={{
        backgroundImage:
          "radial-gradient(circle, rgba(255,255,255,0.26) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
        backgroundPosition: "4px 8px",
        maskImage: "radial-gradient(circle at 18% 12%, black 0%, transparent 62%)",
        WebkitMaskImage:
          "radial-gradient(circle at 18% 12%, black 0%, transparent 62%)",
      }}
    />
  );
}

function CardTopEdge() {
  return (
    <div className="pointer-events-none absolute left-0 right-0 top-0 h-1 overflow-hidden">
      <div
        className="h-full w-full opacity-[0.7]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, rgba(214,64,58,0.95) 0 14px, rgba(255,255,255,0.95) 14px 28px)",
        }}
      />
    </div>
  );
}

function CardShell({
  children,
  className,
  accent,
  onClick,
  role,
  tabIndex,
  onKeyDown,
}: {
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
  onClick?: () => void;
  role?: string;
  tabIndex?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  const clickable = Boolean(onClick);
  return (
    <div
      onClick={onClick}
      onKeyDown={onKeyDown}
      role={role}
      tabIndex={tabIndex}
      className={clsx(
        "relative overflow-hidden rounded-3xl border border-white/15 bg-white/[0.08] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.35)] backdrop-blur-2xl transition",
        clickable
          ? "cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-300/40 hover:-translate-y-0.5 hover:shadow-[0_32px_80px_rgba(0,0,0,0.42)]"
          : "",
        className
      )}
    >
      <CardTopEdge />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: [
            "radial-gradient(circle at 12% 10%, rgba(214,64,58,0.10), transparent 44%)",
            "radial-gradient(circle at 88% 10%, rgba(13,28,51,0.16), transparent 46%)",
          ].join(","),
        }}
      />
      {accent ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 20%, rgba(255,255,255,0.06), transparent 60%)",
          }}
        />
      ) : null}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

function FlagAccent({ className }: { className?: string }) {
  return (
    <div className={clsx("flex items-center gap-3", className)}>
      <span
        className="inline-flex h-6 w-9 items-center justify-center rounded-md border border-white/25 bg-white/10"
        aria-hidden="true"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.9) 1px, transparent 2px)",
          backgroundSize: "10px 10px",
        }}
      />
      <span
        className="h-1.5 w-24 rounded-full border border-white/20"
        aria-hidden="true"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, rgba(214,64,58,0.95) 0 12px, rgba(255,255,255,0.95) 12px 24px)",
        }}
      />
    </div>
  );
}

function getStats(reviews: Review[]) {
  const list = reviews.filter((r) => r.verified);
  if (!list.length) return { avg: 0, count: 0 };
  const avg =
    list.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / list.length;
  return { avg: Number.isFinite(avg) ? avg : 0, count: list.length };
}

function pickHero(reviews: Review[]) {
  if (!reviews.length) return null;
  const featured = reviews.find((r) => r.featured && r.verified);
  if (featured) return featured;
  return [...reviews].sort((a, b) => {
    const rate = b.rating - a.rating;
    if (rate !== 0) return rate;
    const bDate = b.dateISO ? Date.parse(b.dateISO) : 0;
    const aDate = a.dateISO ? Date.parse(a.dateISO) : 0;
    return bDate - aDate;
  })[0];
}

function computeMentions(reviews: Review[]) {
  const merged = MENTION_PRESETS.map((m) => ({ ...m, count: 0 }));
  const text = reviews
    .map((r) => `${r.title || ""} ${r.body}`)
    .join(" ")
    .toLowerCase();
  merged.forEach((m) => {
    let c = 0;
    m.keywords.forEach((kw) => {
      const matches = text.match(new RegExp(`\\b${kw}\\b`, "g"));
      c += matches ? matches.length : 0;
    });
    m.count = c;
  });
  const top = merged
    .filter((m) => m.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  return top.length ? top : merged.slice(0, 6);
}

function swipeHintClass(show: boolean) {
  return clsx(
    "text-xs font-semibold text-white/70 transition-opacity duration-200",
    show ? "opacity-100" : "opacity-0"
  );
}

export default function ReviewsSectionClient({ reviews }: Props) {
  // Deduping: composite key, prefer shopify over legacy
  const deduped = React.useMemo(() => {
    const keyFor = (r: Review) =>
      `${(r.title || "").toLowerCase()}|${r.body.toLowerCase()}|${r.authorName.toLowerCase()}`;
    const map = new Map<string, Review>();
    for (const r of reviews) {
      const k = keyFor(r);
      const existing = map.get(k);
      if (!existing || (existing.source === "legacy" && r.source === "shopify")) {
        map.set(k, r);
      }
    }
    return Array.from(map.values());
  }, [reviews]);

  const verified = React.useMemo(
    () => deduped.filter((r) => r.verified),
    [deduped]
  );
  const { avg, count } = getStats(verified);
  const hero = pickHero(verified);
  const supporting = React.useMemo(
    () => verified.filter((r) => r.id !== hero?.id).slice(0, MAX_SUPPORTING),
    [verified, hero]
  );
  const mentions = React.useMemo(() => computeMentions(verified), [verified]);
  const ugcImages = [
    "/brand/hero.jpg",
    "/home-patriotic-product.jpg",
    "/america-250.jpg",
    "/hero.jpg",
    "/logo.jpg",
  ];

  const [modalOpen, setModalOpen] = React.useState(false);
  const [filter, setFilter] = React.useState<ReviewSource | "all">("all");
  const [sort, setSort] = React.useState<"newest" | "helpful">("newest");
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [hasSwiped, setHasSwiped] = React.useState(false);
  const carouselRef = React.useRef<HTMLDivElement | null>(null);
  const [carouselIndex, setCarouselIndex] = React.useState(0);

  const modalRef = React.useRef<HTMLDivElement | null>(null);
  const closeBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  // Lock background scroll when modal opens
  React.useEffect(() => {
    if (modalOpen) {
      const original = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = original;
      };
    }
  }, [modalOpen]);

  // Throttled carousel index via rAF
  React.useEffect(() => {
    const el = carouselRef.current;
    if (!el) return;
    let frame = 0;
    const handler = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setHasSwiped(true);
        const children = Array.from(el.children);
        const scrollLeft = el.scrollLeft;
        const widths = children.map((c) => (c as HTMLElement).offsetWidth + 12);
        let acc = 0;
        let idx = 0;
        for (let i = 0; i < widths.length; i++) {
          if (scrollLeft + 16 >= acc) idx = i;
          acc += widths[i];
        }
        setCarouselIndex(idx);
      });
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("scroll", handler);
    };
  }, []);

  const filteredList = React.useMemo(() => {
    let list = [...verified];
    if (filter !== "all") list = list.filter((r) => r.source === filter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (r) =>
          r.body.toLowerCase().includes(q) ||
          (r.title || "").toLowerCase().includes(q) ||
          r.authorName.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      if (sort === "helpful") {
        const aH = a.helpfulCount || 0;
        const bH = b.helpfulCount || 0;
        if (bH !== aH) return bH - aH;
      }
      const bDate = b.dateISO ? Date.parse(b.dateISO) : 0;
      const aDate = a.dateISO ? Date.parse(a.dateISO) : 0;
      return bDate - aDate;
    });
    return list;
  }, [verified, filter, sort, query]);

  const openModal = React.useCallback(() => {
    setModalOpen(true);
    setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 0);
  }, []);

  const closeModal = React.useCallback(() => {
    setModalOpen(false);
    setExpanded({});
    setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  React.useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      } else if (e.key === "Tab") {
        const root = modalRef.current;
        if (!root) return;
        const focusables = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((n) => !n.hasAttribute("disabled"));
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modalOpen, closeModal]);

  const onOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) closeModal();
  };

  const scrollToCard = (index: number) => {
    const el = carouselRef.current;
    if (!el) return;
    const child = el.children[index] as HTMLElement | undefined;
    if (child) {
      child.scrollIntoView({ behavior: "smooth", inline: "start" });
      setCarouselIndex(index);
      setHasSwiped(true);
    }
  };

  const keyActivate = (action?: () => void) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      action?.();
    }
  };

  const heroCard = hero ? (
    <CardShell
      className="p-6 border-white/20 bg-white/[0.12]"
      onClick={openModal}
      onKeyDown={keyActivate(openModal)}
      role="button"
      tabIndex={0}
      accent
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-base font-bold text-white">
            {initials(hero.authorName)}
          </div>
          <div className="flex-1 space-y-2">
            <Stars rating={hero.rating} size="md" />
            <div className="flex flex-wrap items-center gap-2">
              <VerifiedBadge source={hero.source} />
              <span className="text-xs text-white/60">
                {formatDate(hero.dateISO)}
              </span>
            </div>
            <div className="text-lg font-extrabold text-white leading-tight">
              {hero.title || hero.body.slice(0, 64) + "..."}
            </div>
            <p className="text-sm text-white/75 line-clamp-6">
              {hero.body}
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openModal();
              }}
              className="text-xs font-semibold text-amber-300 underline underline-offset-4 hover:text-amber-200"
            >
              Read full review
            </button>
          </div>
        </div>
      </div>
    </CardShell>
  ) : (
    <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-6 text-sm text-white/70">
      Verified reviews coming soon.
    </div>
  );

  return (
    <section className="relative mx-auto max-w-6xl px-4 py-12 sm:py-14">
      <div className="relative overflow-hidden rounded-[34px] border border-white/10 bg-white/[0.05] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-8">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-1.5"
          aria-hidden="true"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(214,64,58,0.9) 0 14px, rgba(255,255,255,0.95) 14px 28px)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: [
              "radial-gradient(circle at 10% 0%, rgba(214,64,58,0.08), transparent 38%)",
              "radial-gradient(circle at 88% 10%, rgba(255,255,255,0.06), transparent 42%)",
              "linear-gradient(180deg, rgba(11,20,38,0.0), rgba(11,20,38,0.4))",
            ].join(","),
          }}
        />
        <StarFieldOverlay />
        <div className="relative z-10 space-y-6">
          <div className="space-y-4">
            <FlagAccent />
            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-white/75">
              <Stars rating={avg || 5} size="md" />
              <span>
                {count > 0
                  ? `Rated ${avg.toFixed(1)} by verified buyers (${count} reviews)`
                  : "Verified reviews coming in"}
              </span>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
            <div className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-2xl font-black text-white sm:text-3xl">
                  Clean ingredients. Real reviews.
                </h2>
                <p className="text-sm text-white/70 sm:text-base">
                  Made in the USA. No artificial dyes. Loved for bold flavor and
                  soft texture.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {mentions.map((chip) => (
                  <span
                    key={chip.key}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80 shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
                  >
                    {chip.label}
                  </span>
                ))}
              </div>
              <div className="text-xs text-white/60">
                Verified orders only. No edits.
              </div>
            </div>

            {heroCard}
          </div>

          {hero ? (
            <div className="space-y-4">
              {supporting.length ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div
                      className={clsx(
                        swipeHintClass(!hasSwiped && supporting.length > 1),
                        "sm:hidden"
                      )}
                    >
                      Swipe →
                    </div>
                  </div>
                  <div className="relative">
                    <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-10 bg-[linear-gradient(90deg,rgba(12,20,38,0.85),transparent)]" />
                    <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-10 bg-[linear-gradient(270deg,rgba(12,20,38,0.85),transparent)]" />
                    <div
                      ref={carouselRef}
                      className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2"
                    >
                      {supporting.map((r, i) => (
                        <CardShell
                          key={`${r.id}-${i}`}
                          className="min-w-[260px] snap-start shrink-0 p-4 border-white/12 bg-white/[0.06]"
                          onClick={openModal}
                          onKeyDown={keyActivate(openModal)}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="space-y-2">
                            <Stars rating={r.rating} />
                            <div className="flex items-center gap-2 text-xs text-white/60">
                              <VerifiedBadge source={r.source} />
                              <span>{formatDate(r.dateISO)}</span>
                            </div>
                            <div className="text-base font-bold text-white leading-tight">
                              {r.title || r.body.slice(0, 42) + "..."}
                            </div>
                            <p className="text-sm text-white/75 line-clamp-4">
                              {r.body}
                            </p>
                          </div>
                        </CardShell>
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-center gap-1">
                    {supporting.length > 1
                      ? supporting.map((_, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => scrollToCard(i)}
                            className={clsx(
                              "h-2 w-2 rounded-full",
                              i === carouselIndex ? "bg-white" : "bg-white/30"
                            )}
                            aria-label={`Go to review ${i + 1}`}
                          />
                        ))
                      : null}
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">
                  Customer moments
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {ugcImages.map((src, idx) => (
                    <div
                      key={`${src}-${idx}`}
                      className="relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[0_12px_28px_rgba(0,0,0,0.28)]"
                    >
                      <Image
                        src={src}
                        alt="USA Gummies customer moment"
                        fill
                        className="object-cover"
                        sizes="112px"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <a href={CTA_LINK} className="btn btn-red min-h-[44px]">
                Build my bundle →
              </a>
              <button
                type="button"
                onClick={openModal}
                className="btn btn-outline min-h-[44px]"
                ref={triggerRef}
              >
                See all verified reviews
              </button>
            </div>
          </div>
        </div>
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm sm:items-center"
          onMouseDown={onOverlayClick}
        >
          <div
            ref={modalRef}
            className="mx-auto w-full max-w-3xl rounded-t-3xl bg-[#0c1426] p-5 shadow-2xl sm:rounded-3xl sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reviews-modal-title"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div id="reviews-modal-title" className="text-sm font-semibold text-white/85">
                  Verified reviews
                </div>
                <div className="text-xs text-white/60">
                  Filter, sort, search, expand.
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                ref={closeBtnRef}
                className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <label className="text-xs text-white/60">Source</label>
                <select
                  value={filter}
                  onChange={(e) =>
                    setFilter(e.target.value as ReviewSource | "all")
                  }
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
                >
                  <option value="all">All sources</option>
                  <option value="shopify">Shopify</option>
                  <option value="legacy">Prior store</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-white/60">Sort</label>
                <select
                  value={sort}
                  onChange={(e) =>
                    setSort(e.target.value as "newest" | "helpful")
                  }
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
                >
                  <option value="newest">Newest</option>
                  <option value="helpful">Most helpful</option>
                </select>
              </div>
              <div className="space-y-2 sm:col-span-1">
                <label className="text-xs text-white/60">Search</label>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search review text"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40"
                />
              </div>
            </div>

            <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {filteredList.length === 0 ? (
                <div className="text-sm text-white/70">
                  No verified reviews match those filters yet.
                </div>
              ) : (
                filteredList.map((r) => {
                  const isExpanded = expanded[r.id];
                  const showBody = isExpanded || (r.body || "").length <= 320;
                  const dateLabel = formatDate(r.dateISO);
                  return (
                    <CardShell key={r.id} className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-sm font-bold text-white">
                          {initials(r.authorName)}
                        </div>
                        <div className="flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Stars rating={r.rating} />
                            <VerifiedBadge source={r.source} />
                            {dateLabel ? (
                              <span className="text-xs text-white/60">{dateLabel}</span>
                            ) : null}
                          </div>
                          <div className="text-base font-bold text-white">
                            {r.title || r.body.slice(0, 48) + "..."}
                          </div>
                          <p className="text-sm text-white/75">
                            {showBody ? r.body : r.body.slice(0, 320) + "..."}
                          </p>
                          {r.body.length > 320 ? (
                            <button
                              type="button"
                              onClick={() =>
                                setExpanded((prev) => ({
                                  ...prev,
                                  [r.id]: !prev[r.id],
                                }))
                              }
                              className="text-xs font-semibold text-amber-300 underline underline-offset-4"
                            >
                              {isExpanded ? "Show less" : "Read full review"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </CardShell>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
