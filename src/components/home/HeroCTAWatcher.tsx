"use client";

import { useEffect } from "react";

export default function HeroCTAWatcher() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = document.getElementById("hero-primary-cta");
    const sticky = document.querySelector<HTMLElement>(".sticky-cta-bar");
    if (!target || !sticky) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            sticky.classList.add("hidden");
            sticky.classList.remove("opacity-100", "translate-y-0");
          } else {
            sticky.classList.remove("hidden");
            sticky.classList.add("opacity-100", "translate-y-0");
          }
        });
      },
      {
        root: null,
        threshold: 0.4,
      }
    );

    observer.observe(target);

    return () => observer.disconnect();
  }, []);

  return null;
}
