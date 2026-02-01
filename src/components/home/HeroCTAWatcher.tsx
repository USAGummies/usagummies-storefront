"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

export default function HeroCTAWatcher() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = document.getElementById("hero-primary-cta");
    const story = document.getElementById("why-usa-gummies");
    const sticky = document.querySelector<HTMLElement>(".sticky-cta-bar");
    const heroLink = document.querySelector<HTMLAnchorElement>("[data-hero-scroll]");
    if (!target || !sticky) return;

    let heroVisible = false;
    let storyVisible = false;
    const handleHeroClick = () => {
      trackEvent("hero_scroll_to_bundle", { path: window.location.pathname });
    };

    const setStickyState = () => {
      if (heroVisible || storyVisible) {
        sticky.classList.add("hidden");
        sticky.classList.remove("opacity-100", "translate-y-0");
      } else {
        sticky.classList.remove("hidden");
        sticky.classList.add("opacity-100", "translate-y-0");
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.target === target) {
            heroVisible = entry.isIntersecting;
          } else if (entry.target === story) {
            storyVisible = entry.isIntersecting;
          }
          setStickyState();
        });
      },
      {
        root: null,
        threshold: 0.4,
      }
    );

    observer.observe(target);
    if (story) observer.observe(story);
    if (heroLink) heroLink.addEventListener("click", handleHeroClick);

    return () => {
      observer.disconnect();
      if (heroLink) heroLink.removeEventListener("click", handleHeroClick);
    };
  }, []);

  return null;
}
