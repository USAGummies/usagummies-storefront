"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { pricingForQty, BASE_PRICE, FREE_SHIP_QTY } from "@/lib/bundles/pricing";
import { AMAZON_REVIEWS } from "@/data/amazonReviews";
import type { CartToastDetail } from "@/lib/cartFeedback";

function formatMoney(amount: number) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

type CelebrationData = {
  qty: number;
  pricing: ReturnType<typeof pricingForQty>;
  savings: number;
  freeShipping: boolean;
};

export function CartCelebration() {
  const [data, setData] = useState<CelebrationData | null>(null);
  const [phase, setPhase] = useState<"enter" | "show" | "exit" | "hidden">("hidden");
  const timerRef = useRef<number | null>(null);
  const confettiRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    function handleToast(event: Event) {
      const detail = (event as CustomEvent<CartToastDetail>).detail;
      const qty = Number(detail?.qty ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) return;

      const pricing = pricingForQty(qty);
      const savings = Math.max(0, BASE_PRICE * qty - pricing.total);
      const freeShipping = qty >= FREE_SHIP_QTY;

      setData({ qty, pricing, savings, freeShipping });
      setPhase("enter");

      if (timerRef.current) window.clearTimeout(timerRef.current);
      // Transition: enter -> show -> exit -> hidden
      requestAnimationFrame(() => {
        setPhase("show");
        timerRef.current = window.setTimeout(() => {
          setPhase("exit");
          timerRef.current = window.setTimeout(() => {
            setPhase("hidden");
            setData(null);
          }, 350);
        }, 3800);
      });
    }

    window.addEventListener("cart:toast", handleToast);
    return () => {
      window.removeEventListener("cart:toast", handleToast);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  // Confetti canvas animation
  useEffect(() => {
    if (phase !== "show" && phase !== "enter") {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const canvas = confettiRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(dpr, dpr);

    const COLORS = [
      "#ef3b3b", // red
      "#1a3a6b", // navy
      "#f8d44f", // gold
      "#ffffff", // white
      "#c7362c", // dark red
      "#4caf50", // green
      "#f97316", // orange
    ];

    type Particle = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      w: number;
      h: number;
      color: string;
      rotation: number;
      rotationSpeed: number;
      opacity: number;
      shape: "rect" | "circle" | "star";
    };

    const particles: Particle[] = [];
    const PARTICLE_COUNT = 80;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const shape = i % 5 === 0 ? "star" : i % 3 === 0 ? "circle" : "rect";
      particles.push({
        x: Math.random() * W,
        y: -20 - Math.random() * H * 0.5,
        vx: (Math.random() - 0.5) * 3,
        vy: 2 + Math.random() * 4,
        w: 4 + Math.random() * 8,
        h: 4 + Math.random() * 8,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.15,
        opacity: 0.7 + Math.random() * 0.3,
        shape,
      });
    }

    let running = true;

    function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
      const spikes = 5;
      const outerR = r;
      const innerR = r * 0.45;
      let rot = (Math.PI / 2) * 3;
      const step = Math.PI / spikes;
      ctx.beginPath();
      ctx.moveTo(cx, cy - outerR);
      for (let i = 0; i < spikes; i++) {
        ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
        rot += step;
        ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
        rot += step;
      }
      ctx.closePath();
      ctx.fill();
    }

    function animate() {
      if (!running || !ctx) return;
      ctx.clearRect(0, 0, W, H);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.04; // gravity
        p.rotation += p.rotationSpeed;
        p.vx *= 0.998;

        // wrap horizontally
        if (p.x < -20) p.x = W + 20;
        if (p.x > W + 20) p.x = -20;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;

        if (p.shape === "star") {
          drawStar(ctx, 0, 0, p.w);
        } else if (p.shape === "circle") {
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();

        // fade out once past bottom
        if (p.y > H * 0.8) {
          p.opacity = Math.max(0, p.opacity - 0.015);
        }
      }

      rafRef.current = requestAnimationFrame(animate);
    }

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [phase]);

  function handleDismiss() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setPhase("exit");
    timerRef.current = window.setTimeout(() => {
      setPhase("hidden");
      setData(null);
    }, 350);
  }

  if (phase === "hidden" || !data) return null;

  const { qty, pricing, savings, freeShipping } = data;
  const perBag = formatMoney(pricing.perBag);
  const total = formatMoney(pricing.total);
  const savingsText = savings > 0 ? formatMoney(savings) : null;
  const headline =
    qty >= 12
      ? "Best price locked in!"
      : qty >= 8
        ? "Great choice — most popular size!"
        : qty >= 5
          ? "Free shipping unlocked!"
          : qty >= 4
            ? "Bundle savings activated!"
            : "Added to cart!";
  const subline =
    qty >= 12
      ? `${qty} bags at ${perBag}/bag — our lowest rate.`
      : qty >= 8
        ? `${qty} bags at ${perBag}/bag with free shipping.`
        : qty >= 5
          ? `${qty} bags at ${perBag}/bag. Most customers choose 8.`
          : qty >= 4
            ? `${qty} bags at ${perBag}/bag. Add 1 more for free shipping.`
            : `${qty} bag${qty === 1 ? "" : "s"} at ${perBag}/bag. Bundle up and save.`;

  return (
    <div
      className={[
        "fixed inset-0 z-[60] flex items-center justify-center transition-opacity duration-300",
        phase === "show" ? "opacity-100" : "opacity-0",
      ].join(" ")}
      onClick={handleDismiss}
      role="dialog"
      aria-label="Cart confirmation"
    >
      {/* Confetti canvas */}
      <canvas
        ref={confettiRef}
        className="pointer-events-none absolute inset-0 z-0"
        aria-hidden="true"
      />

      {/* Backdrop */}
      <div className="absolute inset-0 bg-[rgba(13,28,51,0.6)] backdrop-blur-sm" aria-hidden="true" />

      {/* Content card */}
      <div
        className={[
          "relative z-10 mx-4 max-w-sm w-full transform transition-all duration-300",
          phase === "show"
            ? "scale-100 translate-y-0"
            : phase === "enter"
              ? "scale-95 translate-y-4"
              : "scale-95 -translate-y-4",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-[28px] border border-[rgba(199,160,98,0.35)] bg-white p-5 shadow-[0_32px_80px_rgba(15,27,45,0.25)]">
          {/* Checkmark burst */}
          <div className="flex justify-center">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[#ef3b3b] to-[#c7362c] shadow-[0_8px_24px_rgba(239,59,59,0.35)]">
              <svg viewBox="0 0 24 24" className="h-8 w-8 text-white" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 13l4 4L19 7" />
              </svg>
              <div className="absolute inset-0 animate-ping rounded-full bg-[rgba(239,59,59,0.25)]" />
            </div>
          </div>

          {/* Headline */}
          <div className="mt-4 text-center">
            <div className="text-xl font-black text-[var(--text)]">{headline}</div>
            <div className="mt-1 text-sm text-[var(--muted)]">{subline}</div>
          </div>

          {/* Stats row */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] p-2 text-center">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                Bags
              </div>
              <div className="text-lg font-black text-[var(--text)]">{qty}</div>
            </div>
            <div className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] p-2 text-center">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                Per bag
              </div>
              <div className="text-lg font-black text-[var(--text)]">{perBag}</div>
            </div>
            <div className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] p-2 text-center">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                Total
              </div>
              <div className="text-lg font-black text-[var(--text)]">{total}</div>
            </div>
          </div>

          {/* Savings / free shipping badges */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {savingsText ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(239,59,59,0.25)] bg-[rgba(239,59,59,0.08)] px-3 py-1 text-[11px] font-semibold text-[var(--candy-red)]">
                You save {savingsText}
              </span>
            ) : null}
            {freeShipping ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(21,128,61,0.25)] bg-[rgba(21,128,61,0.08)] px-3 py-1 text-[11px] font-semibold text-[rgba(21,128,61,0.95)]">
                🚚 Free shipping
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-3 py-1 text-[11px] font-semibold text-[var(--muted)]">
              🇺🇸 Made in USA
            </span>
          </div>

          {/* Trust line */}
          <div className="mt-3 text-center text-[10px] font-semibold text-[var(--muted)]">
            ⭐ {AMAZON_REVIEWS.aggregate.rating.toFixed(1)} stars from verified Amazon buyers • Satisfaction guaranteed
          </div>

          {/* CTA */}
          <div className="mt-4 grid gap-2">
            <button
              type="button"
              onClick={handleDismiss}
              className="btn btn-candy w-full justify-center pressable text-base"
            >
              Continue shopping
            </button>
            <div className="text-center text-[11px] font-semibold text-[var(--muted)]">
              Cart drawer is open — check out anytime
            </div>
          </div>

          {/* Logo watermark */}
          <div className="mt-3 flex justify-center">
            <Image
              src="/brand/logo.png"
              alt="USA Gummies"
              width={64}
              height={22}
              className="opacity-40"
              aria-hidden="true"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
