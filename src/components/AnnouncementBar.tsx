// src/components/AnnouncementBar.tsx
"use client";

import { useEffect, useState } from "react";

const MESSAGES = [
  "🚚 Free shipping on 5+ bags",
  "⭐ 4.8 stars from verified buyers",
  "🇺🇸 Made in the USA — FDA-registered facility",
  "🎉 Order today — fast, reliable shipping",
];

export function AnnouncementBar() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIdx((i) => (i + 1) % MESSAGES.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="bg-[var(--navy)] text-white text-center text-[11px] sm:text-xs font-semibold py-1.5 px-4 tracking-wide overflow-hidden">
      <div
        key={idx}
        className="animate-[fadeSlide_0.4s_ease-out]"
      >
        {MESSAGES[idx]}
      </div>
      <style jsx>{`
        @keyframes fadeSlide {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
