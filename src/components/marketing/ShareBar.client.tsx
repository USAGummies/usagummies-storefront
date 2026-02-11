"use client";

import { useCallback, useState } from "react";
import { trackEvent } from "@/lib/analytics";

const SITE_URL = "https://www.usagummies.com";
const SHARE_TEXT =
  "Just ordered dye-free gummy bears made in the USA from @usagummies — no artificial dyes, classic flavor. Check them out:";

function shareUrl(platform: string): string {
  const url = encodeURIComponent(SITE_URL);
  const text = encodeURIComponent(SHARE_TEXT);
  switch (platform) {
    case "twitter":
      return `https://twitter.com/intent/tweet?text=${text}&url=${url}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${url}`;
    case "email":
      return `mailto:?subject=${encodeURIComponent("Check out USA Gummies")}&body=${text}%20${url}`;
    case "sms":
      return `sms:?body=${text}%20${url}`;
    default:
      return SITE_URL;
  }
}

export function ShareBar() {
  const [copied, setCopied] = useState(false);

  const copyLink = useCallback(() => {
    navigator.clipboard?.writeText(SITE_URL).then(() => {
      setCopied(true);
      trackEvent("share_link_copied", {});
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  const handleShare = useCallback((platform: string) => {
    trackEvent("share_clicked", { platform });
    if (platform === "email" || platform === "sms") {
      window.location.href = shareUrl(platform);
    } else {
      window.open(shareUrl(platform), "_blank", "width=600,height=400,noopener");
    }
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => handleShare("twitter")}
        className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3.5 py-2 text-xs font-semibold text-[var(--text)] transition-all hover:bg-white hover:shadow-[0_4px_12px_rgba(15,27,45,0.08)] hover:-translate-y-0.5"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
          <path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        Share
      </button>
      <button
        type="button"
        onClick={() => handleShare("facebook")}
        className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3.5 py-2 text-xs font-semibold text-[var(--text)] transition-all hover:bg-white hover:shadow-[0_4px_12px_rgba(15,27,45,0.08)] hover:-translate-y-0.5"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
          <path fill="currentColor" d="M13.5 8.5h3V6h-3c-2.5 0-4.5 2-4.5 4.5V13H7v3h2v5h3v-5h3l1-3h-4v-2.5c0-0.6 0.4-1 1-1z" />
        </svg>
        Share
      </button>
      <button
        type="button"
        onClick={() => handleShare("email")}
        className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3.5 py-2 text-xs font-semibold text-[var(--text)] transition-all hover:bg-white hover:shadow-[0_4px_12px_rgba(15,27,45,0.08)] hover:-translate-y-0.5"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 7l9 6 9-6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        Email
      </button>
      <button
        type="button"
        onClick={() => handleShare("sms")}
        className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3.5 py-2 text-xs font-semibold text-[var(--text)] transition-all hover:bg-white hover:shadow-[0_4px_12px_rgba(15,27,45,0.08)] hover:-translate-y-0.5"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
          <path fill="none" stroke="currentColor" strokeWidth="1.6" d="M4 4h16a2 2 0 012 2v10a2 2 0 01-2 2H8l-4 4V6a2 2 0 012-2z" />
        </svg>
        Text
      </button>
      <button
        type="button"
        onClick={copyLink}
        className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3.5 py-2 text-xs font-semibold text-[var(--text)] transition-all hover:bg-white hover:shadow-[0_4px_12px_rgba(15,27,45,0.08)] hover:-translate-y-0.5"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        {copied ? "Copied!" : "Copy link"}
      </button>
    </div>
  );
}
