"use client";

import { useEffect } from "react";

export default function SceneBackgrounds() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const scenes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-scene-bg]")
    );
    if (!scenes.length) return;

    const applyBg = (el: HTMLElement) => {
      const bg = el.dataset.sceneBg;
      if (!bg) return;
      el.style.setProperty("--scene-bg", `url("${bg}")`);
      delete el.dataset.sceneBg;
    };

    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          applyBg(entry.target as HTMLElement);
          obs.unobserve(entry.target);
        });
      },
      { rootMargin: "200px 0px" }
    );

    scenes.forEach((scene) => observer.observe(scene));

    return () => observer.disconnect();
  }, []);

  return null;
}
