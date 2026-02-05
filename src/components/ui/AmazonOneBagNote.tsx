"use client";

import Image from "next/image";
import { AMAZON_LISTING_URL, AMAZON_LOGO_URL } from "@/lib/amazon";
import { trackEvent } from "@/lib/analytics";

export function AmazonOneBagNote({
  className = "",
  linkClassName = "",
}: {
  className?: string;
  linkClassName?: string;
}) {
  const baseClass = ["text-xs font-semibold text-[var(--muted)]", className]
    .filter(Boolean)
    .join(" ");
  const linkClass = [
    "inline-flex items-center gap-2 underline underline-offset-4 text-[var(--text)] hover:text-[var(--navy)]",
    linkClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={baseClass}>
      Buying 1-4 bags?{" "}
      <a
        href={AMAZON_LISTING_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
        onClick={(event) => {
          const amazonUrl = AMAZON_LISTING_URL;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            trackEvent("amazon_redirect", {
              event_category: "commerce",
              event_label: "amazon_outbound",
              quantity: 1,
              sku: "AAGB-7.5OZ",
              source_page: typeof window !== "undefined" ? window.location.pathname : "",
            });
            return;
          }
          event.preventDefault();
          let didNavigate = false;
          const navigateToAmazon = () => {
            if (didNavigate || typeof window === "undefined") return;
            didNavigate = true;
            window.location.href = amazonUrl;
          };
          trackEvent("amazon_redirect", {
            event_category: "commerce",
            event_label: "amazon_outbound",
            quantity: 1,
            sku: "AAGB-7.5OZ",
            source_page: typeof window !== "undefined" ? window.location.pathname : "",
            event_callback: navigateToAmazon,
          });
          if (typeof window !== "undefined") {
            window.setTimeout(navigateToAmazon, 1200);
          }
        }}
      >
        <Image
          src={AMAZON_LOGO_URL}
          alt="Amazon"
          width={56}
          height={16}
          className="h-3.5 w-auto opacity-85"
        />
        <span>Checkout on Amazon</span>
      </a>
      .
    </div>
  );
}
