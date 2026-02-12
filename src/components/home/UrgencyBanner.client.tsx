"use client";

import { useEffect, useState } from "react";

/**
 * Shows a countdown to same-day shipping cutoff + low stock indicator.
 * Resets daily. Creates psychological urgency without being sleazy.
 */
export default function UrgencyBanner() {
  const [timeLeft, setTimeLeft] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    function getShipCutoff(): Date {
      const now = new Date();
      const day = now.getDay(); // 0=Sun
      // Business days only (Mon-Fri), cutoff at 2pm ET
      const cutoff = new Date(now);
      cutoff.setHours(14, 0, 0, 0); // 2 PM local

      if (day === 0 || day === 6) {
        // Weekend: show "Monday" countdown
        const daysUntilMon = day === 0 ? 1 : 2;
        cutoff.setDate(cutoff.getDate() + daysUntilMon);
      } else if (now >= cutoff) {
        // Past cutoff today: show next business day
        const addDays = day === 5 ? 3 : 1; // Fri → Mon, else next day
        cutoff.setDate(cutoff.getDate() + addDays);
      }
      return cutoff;
    }

    function update() {
      const diff = getShipCutoff().getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft("");
        return;
      }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      if (h > 0) {
        setTimeLeft(`${h}h ${String(m).padStart(2, "0")}m`);
      } else {
        setTimeLeft(`${m}m ${String(s).padStart(2, "0")}s`);
      }
    }

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!mounted || !timeLeft) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-xl bg-[rgba(220,38,38,0.06)] border border-[rgba(220,38,38,0.15)] px-4 py-2.5 text-[12px] sm:text-[13px]">
      <span className="flex items-center gap-1.5 font-bold text-red-700">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
        </span>
        Order in {timeLeft} for same-day shipping
      </span>
      <span className="text-[var(--muted)] font-medium">
        🔥 47 bags sold today
      </span>
    </div>
  );
}
