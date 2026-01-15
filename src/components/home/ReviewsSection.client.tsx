"use client";

import React from "react";

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
  const starClass = size === "md" ? "text-base" : "text-sm";
  return (
    <div
      className={clsx(
        "flex items-center gap-1 text-[var(--candy-yellow)]",
        size === "md" ? "text-base" : "text-sm"
      )}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={starClass}>
          {i < full ? "★" : "☆"}
        </span>
      ))}
    </div>
  );
}

function VerifiedBadge({ source }: { source: ReviewSource }) {
  if (source === "shopify") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-3 py-1 text-xs font-semibold text-[var(--text)]">
        Shopify • Verified buyer
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-3 py-1 text-xs font-semibold text-[var(--text)]">
      Verified buyer (prior store)
    </span>
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
        "relative overflow-hidden rounded-3xl border border-[rgba(15,27,45,0.12)] bg-white p-4 shadow-[0_18px_40px_rgba(15,27,45,0.12)] transition",
        clickable
          ? "cursor-pointer focus:outline-none focus:ring-2 focus:ring-[rgba(239,59,59,0.25)] hover:-translate-y-0.5 hover:shadow-[0_22px_50px_rgba(15,27,45,0.16)]"
          : "",
        className
      )}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: [
            "radial-gradient(circle at 12% 10%, rgba(239,59,59,0.08), transparent 44%)",
            "radial-gradient(circle at 88% 10%, rgba(255,199,44,0.12), transparent 46%)",
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

function getStats(reviews: Review[]) {
  const list = reviews.filter((r) => r.verified);
  if (!list.length) return { avg: 0, count: 0 };
  const avg =
    list.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / list.length;
  return { avg: Number.isFinite(avg) ? avg : 0, count: list.length };
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
  const [modalOpen, setModalOpen] = React.useState(false);
  const [filter, setFilter] = React.useState<ReviewSource | "all">("all");
  const [sort, setSort] = React.useState<"newest" | "helpful">("newest");
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
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

  return (
    <section className="relative">
      <div className="candy-panel relative overflow-hidden rounded-[32px] p-4 sm:p-5">
        <div
          className="pointer-events-none absolute inset-x-6 top-0 h-px bg-[rgba(239,59,59,0.32)]"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: [
              "radial-gradient(circle at 12% 0%, rgba(255,77,79,0.06), transparent 46%)",
              "radial-gradient(circle at 88% 10%, rgba(255,199,44,0.08), transparent 48%)",
              "linear-gradient(180deg, rgba(255,255,255,0.0), rgba(255,255,255,0.5))",
            ].join(","),
          }}
        />
        <div className="relative z-10 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
            <Stars rating={avg || 5} size="md" />
            <span>
              {count > 0
                ? `Rated ${avg.toFixed(1)} by verified buyers (${count} reviews)`
                : "Verified reviews coming in"}
            </span>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm text-[var(--muted)] sm:text-base">
              Verified buyer feedback, always unedited.
            </p>
            <h2 className="text-xl font-bold text-[var(--text)] sm:text-2xl">
              Made in the USA. Real reviews.
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openModal}
              className="btn btn-outline min-h-[40px] text-xs"
              ref={triggerRef}
            >
              See all verified reviews
            </button>
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
            className="mx-auto w-full max-w-3xl rounded-t-3xl border border-[rgba(15,27,45,0.12)] bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reviews-modal-title"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div id="reviews-modal-title" className="text-sm font-semibold text-[var(--text)]">
                  Verified reviews
                </div>
                <div className="text-xs text-[var(--muted)]">
                  Filter, sort, search, expand.
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                ref={closeBtnRef}
                className="rounded-full bg-[var(--surface-strong)] px-3 py-1 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)]"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <label className="text-xs text-[var(--muted)]">Source</label>
                <select
                  value={filter}
                  onChange={(e) =>
                    setFilter(e.target.value as ReviewSource | "all")
                  }
                  className="w-full rounded-xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--text)]"
                >
                  <option value="all">All sources</option>
                  <option value="shopify">Shopify</option>
                  <option value="legacy">Prior store</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-[var(--muted)]">Sort</label>
                <select
                  value={sort}
                  onChange={(e) =>
                    setSort(e.target.value as "newest" | "helpful")
                  }
                  className="w-full rounded-xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--text)]"
                >
                  <option value="newest">Newest</option>
                  <option value="helpful">Most helpful</option>
                </select>
              </div>
              <div className="space-y-2 sm:col-span-1">
                <label className="text-xs text-[var(--muted)]">Search</label>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search review text"
                  className="w-full rounded-xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)]"
                />
              </div>
            </div>

            <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {filteredList.length === 0 ? (
                <div className="text-sm text-[var(--muted)]">
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
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--surface-strong)] text-sm font-bold text-[var(--text)]">
                          {initials(r.authorName)}
                        </div>
                        <div className="flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Stars rating={r.rating} />
                            <VerifiedBadge source={r.source} />
                            {dateLabel ? (
                              <span className="text-xs text-[var(--muted)]">{dateLabel}</span>
                            ) : null}
                          </div>
                          <div className="text-base font-bold text-[var(--text)]">
                            {r.title || r.body.slice(0, 48) + "..."}
                          </div>
                          <p className="text-sm text-[var(--muted)]">
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
                              className="text-xs font-semibold text-[var(--candy-red)] underline underline-offset-4"
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
