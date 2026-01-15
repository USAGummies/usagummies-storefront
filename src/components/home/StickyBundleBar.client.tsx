"use client";

import { useEffect, useState } from "react";

type Selected = {
  label?: string;
  total?: string;
  url?: string;
  primaryHref?: string;
  primaryLabel?: string;
};

export function StickyBundleBar({ selected }: { selected?: Selected }) {
  const [show, setShow] = useState(false);
  const [targetId] = useState("bundle-quickbuy-anchor");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = document.getElementById(targetId);
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setShow(!entry.isIntersecting);
      },
      { rootMargin: "0px", threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [targetId]);

  if (!show || !selected?.label || !(selected?.primaryHref || selected?.url)) return null;

  const primaryHref = selected.primaryHref || selected.url;
  const primaryLabel = selected.primaryLabel || "Buy now";

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 block sm:hidden"
      style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto max-w-6xl px-3">
        <div className="candy-panel rounded-2xl border border-[var(--border)] bg-white/95 text-[var(--text)] shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-black truncate">{selected.label}</div>
              <div className="text-xs text-[var(--muted)]">{selected.total}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (primaryHref) window.location.href = primaryHref;
                }}
                className="btn btn-candy px-3 py-2 text-sm font-black"
              >
                {primaryLabel}
              </button>
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById(targetId);
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="text-xs font-semibold text-[var(--red)] underline underline-offset-4"
              >
                View options
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
