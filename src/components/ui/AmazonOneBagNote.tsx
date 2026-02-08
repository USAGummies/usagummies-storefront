"use client";

import Image from "next/image";
import { useRef } from "react";
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
  const amazonPrefireRef = useRef(0);
  const amazonPrefireWindowMs = 1500;
  const shouldFireAmazon = () =>
    Date.now() - amazonPrefireRef.current > amazonPrefireWindowMs;
  const markAmazonFired = () => {
    amazonPrefireRef.current = Date.now();
  };

  return (
    <div className={baseClass}>
      Buying 1-4 bags?{" "}
      <a
        href={AMAZON_LISTING_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
        onPointerDown={() => {
          if (!shouldFireAmazon()) return;
          markAmazonFired();
          trackEvent("amazon_redirect", {
            event_category: "commerce",
            event_label: "amazon_outbound",
            quantity: 1,
            sku: "AAGB-7.5OZ",
            item_id: "AAGB-7.5OZ",
            source_page: typeof window !== "undefined" ? window.location.pathname : "",
            destination: "amazon",
            destination_host: "amazon.com",
            destination_url: AMAZON_LISTING_URL,
            cta_location: "helper_link",
            selected_flow: "amazon",
            bundle_tier: "1",
          });
        }}
        onClick={(event) => {
          const amazonUrl = AMAZON_LISTING_URL;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            trackEvent("amazon_redirect", {
              event_category: "commerce",
              event_label: "amazon_outbound",
              quantity: 1,
              sku: "AAGB-7.5OZ",
              item_id: "AAGB-7.5OZ",
              source_page: typeof window !== "undefined" ? window.location.pathname : "",
              destination: "amazon",
              destination_host: "amazon.com",
              destination_url: amazonUrl,
              cta_location: "helper_link",
              selected_flow: "amazon",
              bundle_tier: "1",
            });
            return;
          }
          event.preventDefault();
          let didNavigate = false;
          const openedWindow =
            typeof window !== "undefined"
              ? window.open("", "_blank", "noopener,noreferrer")
              : null;
          const navigateToAmazon = () => {
            if (didNavigate || typeof window === "undefined") return;
            didNavigate = true;
            if (openedWindow && !openedWindow.closed) {
              openedWindow.location.href = amazonUrl;
            } else {
              window.open(amazonUrl, "_blank", "noopener,noreferrer");
            }
          };
          if (shouldFireAmazon()) {
            markAmazonFired();
            trackEvent("amazon_redirect", {
              event_category: "commerce",
              event_label: "amazon_outbound",
              quantity: 1,
              sku: "AAGB-7.5OZ",
              item_id: "AAGB-7.5OZ",
              source_page: typeof window !== "undefined" ? window.location.pathname : "",
              destination: "amazon",
              destination_host: "amazon.com",
              destination_url: amazonUrl,
              cta_location: "helper_link",
              selected_flow: "amazon",
              bundle_tier: "1",
              event_callback: navigateToAmazon,
            });
          }
          if (typeof window !== "undefined") {
            window.setTimeout(navigateToAmazon, 1200);
          }
        }}
      >
        <Image
          src={AMAZON_LOGO_URL}
          alt="Amazon logo"
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
