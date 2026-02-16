"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { trackEvent } from "@/lib/analytics";

/* ───────────────────── Types ───────────────────── */

type Step = "welcome" | "review" | "spin" | "prize";

interface PrizeResult {
  code: string;
  prize_tier: string;
  prize_description: string;
  discount_type: string;
  discount_value: number;
  already_claimed: boolean;
}

/* ───────────────────── Constants ───────────────────── */

const AMAZON_REVIEW_URL =
  "https://www.amazon.com/dp/B0DK1DP3WF";

const WHEEL_SEGMENTS = [
  { label: "$1 OFF", color: "#1B2A4A", tier: "1_off" },
  { label: "$2 OFF", color: "#c7362c", tier: "2_off" },
  { label: "FREE SHIP", color: "#2D7A3A", tier: "free_shipping" },
  { label: "$3 OFF", color: "#5f5b56", tier: "3_off" },
  { label: "10% OFF", color: "#c7a062", tier: "10_pct_off" },
  { label: "FREE BAG", color: "#8B0000", tier: "free_bag" },
] as const;

const LS_KEY = "usa_review_reward";

/* ───────────────────── Main Component ───────────────────── */

export default function ReviewFlow() {
  const [step, setStep] = useState<Step>("welcome");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [isSpinning, setIsSpinning] = useState(false);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [prize, setPrize] = useState<PrizeResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [loading, setLoading] = useState(false);
  const wheelRef = useRef<HTMLDivElement>(null);

  // Check localStorage on mount for returning users
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (data.code && data.email) {
          setEmail(data.email);
          setPrize(data);
          setStep("prize");
        }
      }
    } catch {
      // ignore
    }
    trackEvent("review_flow_start", {
      referrer: document.referrer || "(none)",
    });
  }, []);

  /* ── Step transitions ── */

  const handleEmailSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = email.trim().toLowerCase();
      if (!trimmed || !trimmed.includes("@") || !trimmed.includes(".")) {
        setEmailError("Please enter a valid email address.");
        return;
      }
      setEmailError("");
      setStep("review");
      trackEvent("review_email_entered", { email: trimmed });
    },
    [email]
  );

  const handleReviewLinkClick = useCallback(() => {
    trackEvent("review_link_clicked", { email });
  }, [email]);

  const handleReviewClaimed = useCallback(() => {
    setStep("spin");
    trackEvent("review_claimed", { email });
  }, [email]);

  const handleSpin = useCallback(async () => {
    if (isSpinning || loading) return;
    setIsSpinning(true);
    setLoading(true);
    trackEvent("wheel_spun", { email });

    try {
      const res = await fetch("/api/review-reward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();

      if (!data.ok) {
        setEmailError(data.error || "Something went wrong. Please try again.");
        setIsSpinning(false);
        setLoading(false);
        return;
      }

      // Find the segment index for the won prize
      const wonIndex = WHEEL_SEGMENTS.findIndex(
        (s) => s.tier === data.prize_tier
      );
      const segmentAngle = 360 / WHEEL_SEGMENTS.length;
      // Calculate target rotation: several full spins + land on the winning segment
      // The wheel pointer is at the top (12 o'clock). Segment 0 starts at 0 degrees.
      // To land pointer on segment i, we rotate so that segment's center is at top.
      const targetSegmentRotation =
        360 - (wonIndex * segmentAngle + segmentAngle / 2);
      const fullSpins = 360 * (5 + Math.floor(Math.random() * 3)); // 5-7 full spins
      const finalRotation = wheelRotation + fullSpins + targetSegmentRotation;

      setWheelRotation(finalRotation);

      // Wait for the spin animation to complete
      setTimeout(() => {
        setPrize({
          code: data.code,
          prize_tier: data.prize_tier,
          prize_description: data.prize_description,
          discount_type: data.discount_type,
          discount_value: data.discount_value,
          already_claimed: data.already_claimed || false,
        });

        // Save to localStorage
        try {
          localStorage.setItem(
            LS_KEY,
            JSON.stringify({
              code: data.code,
              email: email.trim().toLowerCase(),
              prize_tier: data.prize_tier,
              prize_description: data.prize_description,
              discount_type: data.discount_type,
              discount_value: data.discount_value,
            })
          );
        } catch {
          // ignore
        }

        setShowConfetti(true);
        setIsSpinning(false);
        setLoading(false);
        setStep("prize");

        trackEvent("prize_won", {
          email,
          prize_tier: data.prize_tier,
          code: data.code,
        });

        // Clear confetti after a few seconds
        setTimeout(() => setShowConfetti(false), 4000);
      }, 4500);
    } catch {
      setEmailError("Network error. Please try again.");
      setIsSpinning(false);
      setLoading(false);
    }
  }, [isSpinning, loading, email, wheelRotation]);

  const handleCopyCode = useCallback(() => {
    if (!prize) return;
    navigator.clipboard.writeText(prize.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      trackEvent("code_copied", {
        email,
        code: prize.code,
        prize_tier: prize.prize_tier,
      });
    });
  }, [prize, email]);

  const shareText = `I just got a reward from USA Gummies! All natural, American-made gummy bears. Check them out: https://www.usagummies.com/go`;

  /* ───────────────────── Render ───────────────────── */

  return (
    <div className="rv-root">
      <style>{`
        .rv-root {
          min-height: 100vh;
          background: #f8f5ef !important;
          color: #1B2A4A;
          font-family: var(--font-sans), 'Space Grotesk', system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
          overflow-x: hidden;
        }
        .rv-root * { box-sizing: border-box; }
        .rv-display {
          font-family: var(--font-display), 'Oswald', sans-serif;
        }
        @keyframes rv-fadeUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes rv-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        @keyframes rv-confetti {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        @keyframes rv-shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes rv-bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        .rv-animate { animation: rv-fadeUp 0.7s ease-out both; }
        .rv-animate-d1 { animation: rv-fadeUp 0.7s 0.15s ease-out both; }
        .rv-animate-d2 { animation: rv-fadeUp 0.7s 0.3s ease-out both; }
        .rv-animate-d3 { animation: rv-fadeUp 0.7s 0.45s ease-out both; }
        .rv-cta {
          display: block;
          width: 100%;
          padding: 18px;
          background: #c7362c;
          color: #ffffff;
          font-family: var(--font-display), 'Oswald', sans-serif;
          font-size: 20px;
          letter-spacing: 1.5px;
          text-align: center;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          text-decoration: none;
          transition: background 0.2s, transform 0.15s;
        }
        .rv-cta:hover {
          background: #a82920;
          transform: translateY(-1px);
        }
        .rv-cta:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }
        .rv-secondary-btn {
          display: block;
          width: 100%;
          padding: 16px;
          background: #1B2A4A;
          color: #ffffff;
          font-family: var(--font-display), 'Oswald', sans-serif;
          font-size: 18px;
          letter-spacing: 1px;
          text-align: center;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          text-decoration: none;
          transition: background 0.2s, transform 0.15s;
        }
        .rv-secondary-btn:hover {
          background: #2a3f6b;
          transform: translateY(-1px);
        }
        .rv-input {
          width: 100%;
          padding: 16px 18px;
          font-size: 17px;
          border: 2px solid #e0dcd6;
          border-radius: 12px;
          background: #ffffff;
          color: #1B2A4A;
          font-family: var(--font-sans), 'Space Grotesk', system-ui, sans-serif;
          outline: none;
          transition: border-color 0.2s;
        }
        .rv-input:focus {
          border-color: #c7362c;
        }
        .rv-input::placeholder {
          color: #9e9a94;
        }

        /* ── Wheel styles ── */
        .rv-wheel-container {
          position: relative;
          width: 300px;
          height: 300px;
          margin: 0 auto;
        }
        @media (min-width: 420px) {
          .rv-wheel-container {
            width: 340px;
            height: 340px;
          }
        }
        .rv-wheel {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          position: relative;
          overflow: hidden;
          border: 6px solid #1B2A4A;
          box-shadow: 0 8px 32px rgba(27,42,74,0.2), inset 0 0 0 3px rgba(255,255,255,0.3);
          transition: transform 4.5s cubic-bezier(0.17, 0.67, 0.12, 0.99);
        }
        .rv-wheel-pointer {
          position: absolute;
          top: -18px;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 16px solid transparent;
          border-right: 16px solid transparent;
          border-top: 28px solid #c7362c;
          z-index: 10;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        }
        .rv-wheel-center {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: #ffffff;
          border: 4px solid #1B2A4A;
          z-index: 5;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }

        /* ── Confetti ── */
        .rv-confetti-piece {
          position: fixed;
          top: -10px;
          width: 10px;
          height: 10px;
          z-index: 1000;
          animation: rv-confetti 3s ease-out forwards;
        }

        /* ── Share buttons ── */
        .rv-share-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 10px 16px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          text-decoration: none;
          color: #ffffff;
          transition: opacity 0.2s, transform 0.15s;
        }
        .rv-share-btn:hover {
          opacity: 0.85;
          transform: translateY(-1px);
        }

        /* ── Code display ── */
        .rv-code-display {
          background: #ffffff;
          border: 3px dashed #c7362c;
          border-radius: 16px;
          padding: 20px;
          text-align: center;
          position: relative;
        }
        .rv-code-text {
          font-family: var(--font-display), 'Oswald', sans-serif;
          font-size: 32px;
          letter-spacing: 4px;
          color: #c7362c;
          font-weight: 700;
          user-select: all;
        }
      `}</style>

      {/* Confetti overlay */}
      {showConfetti && <ConfettiOverlay />}

      {/* Header */}
      <header
        className="rv-animate"
        style={{
          background: "rgba(255,255,255,0.96)",
          borderBottom: "1px solid rgba(15,27,45,0.12)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div
          style={{
            maxWidth: 600,
            margin: "0 auto",
            padding: "12px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Link
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              textDecoration: "none",
            }}
          >
            <Image
              src="/brand/logo.png"
              alt="USA Gummies logo"
              width={120}
              height={40}
              style={{ height: 36, width: "auto", objectFit: "contain" }}
              priority
            />
          </Link>
          <span
            style={{
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#1B2A4A",
            }}
          >
            VIP REWARDS
          </span>
        </div>
      </header>

      {/* Top accent bar */}
      <div
        style={{
          height: 4,
          background: "linear-gradient(90deg, #c7362c, #1B2A4A, #c7362c)",
        }}
      />

      {/* Main content area */}
      <main
        style={{
          maxWidth: 520,
          margin: "0 auto",
          padding: "24px 20px 80px",
        }}
      >
        {/* ═══════ Step 1: Welcome ═══════ */}
        {step === "welcome" && (
          <div className="rv-animate">
            {/* Flag/VIP badge */}
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: "#1B2A4A",
                  color: "#ffffff",
                  padding: "8px 20px",
                  borderRadius: 50,
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: "2px",
                }}
                className="rv-display"
              >
                <span style={{ fontSize: 20 }}>&#127482;&#127480;</span> YOU&apos;RE A VIP
              </div>
            </div>

            {/* Hero image */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: 20,
              }}
              className="rv-animate-d1"
            >
              <div style={{ position: "relative", width: 160 }}>
                <Image
                  src="/Hero-pack.jpeg"
                  alt="USA Gummies bag"
                  width={320}
                  height={400}
                  style={{
                    width: "100%",
                    height: "auto",
                    borderRadius: 14,
                    boxShadow: "0 16px 40px rgba(27,42,74,0.15)",
                  }}
                  priority
                />
              </div>
            </div>

            <div style={{ textAlign: "center" }} className="rv-animate-d1">
              <h1
                className="rv-display"
                style={{
                  fontSize: 28,
                  lineHeight: 1.1,
                  color: "#1B2A4A",
                  margin: "0 0 10px",
                }}
              >
                Thanks for Choosing{" "}
                <span style={{ color: "#c7362c" }}>USA Gummies!</span>
              </h1>
              <p
                style={{
                  fontSize: 15,
                  lineHeight: 1.6,
                  color: "#5f5b56",
                  margin: "0 0 24px",
                }}
              >
                Share your experience and spin the wheel for an exclusive
                reward. <strong>Every spin wins!</strong>
              </p>
            </div>

            {/* Email form */}
            <form onSubmit={handleEmailSubmit} className="rv-animate-d2">
              <div style={{ marginBottom: 12 }}>
                <input
                  type="email"
                  className="rv-input"
                  placeholder="Enter your email to get started"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError("");
                  }}
                  autoComplete="email"
                  required
                />
                {emailError && (
                  <p
                    style={{
                      color: "#c7362c",
                      fontSize: 13,
                      marginTop: 6,
                      marginBottom: 0,
                    }}
                  >
                    {emailError}
                  </p>
                )}
              </div>
              <button type="submit" className="rv-cta rv-display">
                CONTINUE
              </button>
            </form>

            {/* How it works */}
            <div
              className="rv-animate-d3"
              style={{
                marginTop: 28,
                padding: "20px",
                background: "#ffffff",
                borderRadius: 16,
                border: "1px solid #e0dcd6",
              }}
            >
              <div
                className="rv-display"
                style={{
                  fontSize: 14,
                  letterSpacing: "2px",
                  color: "#5f5b56",
                  marginBottom: 14,
                  textAlign: "center",
                }}
              >
                HOW IT WORKS
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  { num: "1", text: "Enter your email" },
                  { num: "2", text: "Share your experience on Amazon" },
                  { num: "3", text: "Spin the wheel & win a prize!" },
                ].map((item) => (
                  <div
                    key={item.num}
                    style={{ display: "flex", alignItems: "center", gap: 12 }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: "#c7362c",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 700,
                        fontSize: 15,
                        flexShrink: 0,
                      }}
                      className="rv-display"
                    >
                      {item.num}
                    </div>
                    <span style={{ fontSize: 15, color: "#1B2A4A", fontWeight: 500 }}>
                      {item.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Disclaimer */}
            <p
              style={{
                fontSize: 11,
                color: "#9e9a94",
                textAlign: "center",
                marginTop: 16,
                lineHeight: 1.5,
              }}
            >
              Reward is for sharing your experience. A positive review is not
              required. One reward per customer per 30 days.
            </p>
          </div>
        )}

        {/* ═══════ Step 2: Leave Your Review ═══════ */}
        {step === "review" && (
          <div className="rv-animate">
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              {/* Progress indicator */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: 8,
                  marginBottom: 20,
                }}
              >
                {["Email", "Review", "Spin", "Prize"].map((label, i) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: i <= 1 ? "#c7362c" : "#e0dcd6",
                        color: i <= 1 ? "#fff" : "#9e9a94",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                      className="rv-display"
                    >
                      {i === 0 ? "\u2713" : i + 1}
                    </div>
                    {i < 3 && (
                      <div
                        style={{
                          width: 20,
                          height: 2,
                          background: i < 1 ? "#c7362c" : "#e0dcd6",
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 40, marginBottom: 8 }}>&#11088;</div>
              <h2
                className="rv-display"
                style={{
                  fontSize: 26,
                  color: "#1B2A4A",
                  margin: "0 0 8px",
                  lineHeight: 1.15,
                }}
              >
                Help Fellow Gummy Lovers!
              </h2>
              <p style={{ fontSize: 15, color: "#5f5b56", margin: 0, lineHeight: 1.5 }}>
                A quick review helps other customers discover all-natural,
                American-made gummy bears.
              </p>
            </div>

            <a
              href={AMAZON_REVIEW_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleReviewLinkClick}
              className="rv-cta rv-display"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                animation: "rv-pulse 2s ease-in-out infinite",
              }}
            >
              <span style={{ fontSize: 22 }}>&#9733;</span>
              LEAVE A REVIEW ON AMAZON
            </a>

            <div
              style={{
                textAlign: "center",
                margin: "24px 0",
                position: "relative",
              }}
            >
              <div
                style={{
                  height: 1,
                  background: "#e0dcd6",
                  position: "absolute",
                  top: "50%",
                  left: 0,
                  right: 0,
                }}
              />
              <span
                style={{
                  position: "relative",
                  background: "#f8f5ef",
                  padding: "0 16px",
                  color: "#9e9a94",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                Already left a review?
              </span>
            </div>

            <button
              onClick={handleReviewClaimed}
              className="rv-secondary-btn rv-display"
            >
              I&apos;VE LEFT MY REVIEW &rarr;
            </button>

            <p
              style={{
                fontSize: 12,
                color: "#9e9a94",
                textAlign: "center",
                marginTop: 14,
                lineHeight: 1.5,
              }}
            >
              Reward is for sharing your experience. A positive review is not
              required.
            </p>
          </div>
        )}

        {/* ═══════ Step 3: Spin the Wheel ═══════ */}
        {step === "spin" && (
          <div className="rv-animate">
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              {/* Progress indicator */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: 8,
                  marginBottom: 20,
                }}
              >
                {["Email", "Review", "Spin", "Prize"].map((label, i) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: i <= 2 ? "#c7362c" : "#e0dcd6",
                        color: i <= 2 ? "#fff" : "#9e9a94",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                      className="rv-display"
                    >
                      {i < 2 ? "\u2713" : i + 1}
                    </div>
                    {i < 3 && (
                      <div
                        style={{
                          width: 20,
                          height: 2,
                          background: i < 2 ? "#c7362c" : "#e0dcd6",
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>

              <h2
                className="rv-display"
                style={{
                  fontSize: 28,
                  color: "#1B2A4A",
                  margin: "0 0 6px",
                }}
              >
                Spin &amp; Win!
              </h2>
              <p style={{ fontSize: 15, color: "#5f5b56", margin: 0 }}>
                Every spin wins a prize. Good luck!
              </p>
            </div>

            {/* The Wheel */}
            <div className="rv-wheel-container rv-animate-d1">
              <div className="rv-wheel-pointer" />
              <div
                ref={wheelRef}
                className="rv-wheel"
                style={{
                  transform: `rotate(${wheelRotation}deg)`,
                }}
              >
                <WheelSegments />
              </div>
              <div className="rv-wheel-center">
                <span>&#127482;&#127480;</span>
              </div>
            </div>

            {/* Spin button */}
            <div style={{ marginTop: 24 }} className="rv-animate-d2">
              <button
                onClick={handleSpin}
                disabled={isSpinning}
                className="rv-cta rv-display"
                style={
                  isSpinning
                    ? {}
                    : { animation: "rv-pulse 2s ease-in-out infinite" }
                }
              >
                {isSpinning ? "SPINNING..." : "SPIN THE WHEEL"}
              </button>
            </div>

            {emailError && (
              <p
                style={{
                  color: "#c7362c",
                  fontSize: 13,
                  textAlign: "center",
                  marginTop: 12,
                }}
              >
                {emailError}
              </p>
            )}
          </div>
        )}

        {/* ═══════ Step 4: Prize ═══════ */}
        {step === "prize" && prize && (
          <div className="rv-animate">
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              {/* Progress indicator - all complete */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: 8,
                  marginBottom: 20,
                }}
              >
                {["Email", "Review", "Spin", "Prize"].map((label, i) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: "#2D7A3A",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                      className="rv-display"
                    >
                      &#10003;
                    </div>
                    {i < 3 && (
                      <div
                        style={{
                          width: 20,
                          height: 2,
                          background: "#2D7A3A",
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 48, marginBottom: 6 }}>&#127881;</div>
              <h2
                className="rv-display"
                style={{
                  fontSize: 30,
                  color: "#1B2A4A",
                  margin: "0 0 6px",
                }}
              >
                {prize.already_claimed ? "Welcome Back!" : "Congratulations!"}
              </h2>
              <p
                className="rv-display"
                style={{
                  fontSize: 20,
                  color: "#c7362c",
                  margin: 0,
                  letterSpacing: "1px",
                }}
              >
                You won: {prize.prize_description}
              </p>
            </div>

            {/* Code display */}
            <div className="rv-code-display rv-animate-d1">
              <div
                style={{
                  fontSize: 12,
                  color: "#5f5b56",
                  marginBottom: 8,
                  fontWeight: 600,
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                }}
              >
                Your discount code
              </div>
              <div className="rv-code-text">{prize.code}</div>
              <button
                onClick={handleCopyCode}
                style={{
                  marginTop: 14,
                  padding: "10px 28px",
                  background: copied ? "#2D7A3A" : "#1B2A4A",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  letterSpacing: "1px",
                  transition: "background 0.2s",
                }}
                className="rv-display"
              >
                {copied ? "\u2713 COPIED!" : "COPY CODE"}
              </button>
            </div>

            {/* Shop CTA */}
            <div style={{ marginTop: 20 }} className="rv-animate-d2">
              <Link href="/go" className="rv-cta rv-display">
                SHOP NOW &amp; USE YOUR CODE
              </Link>
              <p
                style={{
                  fontSize: 12,
                  color: "#5f5b56",
                  textAlign: "center",
                  marginTop: 10,
                }}
              >
                Apply your code at checkout on usagummies.com
              </p>
            </div>

            {/* Share section */}
            <div
              className="rv-animate-d3"
              style={{
                marginTop: 28,
                padding: "20px",
                background: "#ffffff",
                borderRadius: 16,
                border: "1px solid #e0dcd6",
                textAlign: "center",
              }}
            >
              <div
                className="rv-display"
                style={{
                  fontSize: 14,
                  letterSpacing: "2px",
                  color: "#5f5b56",
                  marginBottom: 14,
                }}
              >
                SHARE WITH A FRIEND
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <a
                  href={`sms:&body=${encodeURIComponent(shareText)}`}
                  className="rv-share-btn"
                  style={{ background: "#2D7A3A" }}
                >
                  <span>&#128172;</span> iMessage
                </a>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rv-share-btn"
                  style={{ background: "#25D366" }}
                >
                  <span>&#128172;</span> WhatsApp
                </a>
                <a
                  href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent("https://www.usagummies.com/go")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rv-share-btn"
                  style={{ background: "#1877F2" }}
                >
                  <span>f</span> Facebook
                </a>
                <a
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rv-share-btn"
                  style={{ background: "#1B2A4A" }}
                >
                  <span>&#120143;</span> Twitter
                </a>
                <a
                  href={`mailto:?subject=${encodeURIComponent("Check out USA Gummies!")}&body=${encodeURIComponent(shareText)}`}
                  className="rv-share-btn"
                  style={{ background: "#5f5b56" }}
                >
                  <span>&#9993;</span> Email
                </a>
              </div>
            </div>

            {/* Disclaimer */}
            <p
              style={{
                fontSize: 11,
                color: "#9e9a94",
                textAlign: "center",
                marginTop: 16,
                lineHeight: 1.5,
              }}
            >
              Discount codes are valid for one use only. Cannot be combined with
              other offers. Codes expire in 90 days.
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer
        style={{
          background: "#1B2A4A",
          color: "rgba(255,255,255,0.6)",
          textAlign: "center",
          padding: "24px 20px",
          fontSize: 12,
        }}
      >
        <p style={{ margin: 0 }}>
          &copy; 2026 USA Gummies &middot;{" "}
          <a
            href="https://www.usagummies.com"
            style={{
              color: "rgba(255,255,255,0.8)",
              textDecoration: "none",
            }}
          >
            usagummies.com
          </a>{" "}
          &middot; Made with &#127482;&#127480; in America
        </p>
      </footer>
    </div>
  );
}

/* ───────────────────── Wheel Segments (SVG-based) ───────────────────── */

function WheelSegments() {
  const numSegments = WHEEL_SEGMENTS.length;
  const segmentAngle = 360 / numSegments;

  return (
    <svg
      viewBox="0 0 300 300"
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      {WHEEL_SEGMENTS.map((seg, i) => {
        const startAngle = i * segmentAngle - 90; // Start from top
        const endAngle = startAngle + segmentAngle;
        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;
        const cx = 150;
        const cy = 150;
        const r = 150;

        const x1 = cx + r * Math.cos(startRad);
        const y1 = cy + r * Math.sin(startRad);
        const x2 = cx + r * Math.cos(endRad);
        const y2 = cy + r * Math.sin(endRad);

        const largeArc = segmentAngle > 180 ? 1 : 0;
        const path = `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z`;

        // Text position (middle of the segment, 60% radius out)
        const midAngle = ((startAngle + endAngle) / 2) * (Math.PI / 180);
        const textR = r * 0.62;
        const textX = cx + textR * Math.cos(midAngle);
        const textY = cy + textR * Math.sin(midAngle);
        const textRotation = (startAngle + endAngle) / 2;

        return (
          <g key={seg.tier}>
            <path d={path} fill={seg.color} stroke="#ffffff" strokeWidth="1.5" />
            <text
              x={textX}
              y={textY}
              fill="#ffffff"
              fontSize="15"
              fontWeight="700"
              fontFamily="Oswald, sans-serif"
              textAnchor="middle"
              dominantBaseline="central"
              transform={`rotate(${textRotation}, ${textX}, ${textY})`}
              style={{ letterSpacing: "1px" }}
            >
              {seg.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ───────────────────── Confetti Overlay ───────────────────── */

function ConfettiOverlay() {
  const colors = ["#c7362c", "#1B2A4A", "#2D7A3A", "#c7a062", "#ffffff", "#ff6b6b", "#4ecdc4"];
  const pieces = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 2,
    duration: 2 + Math.random() * 2,
    color: colors[i % colors.length],
    size: 6 + Math.random() * 8,
    shape: Math.random() > 0.5 ? "circle" : "square",
  }));

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: "none",
        zIndex: 1000,
        overflow: "hidden",
      }}
    >
      {pieces.map((p) => (
        <div
          key={p.id}
          className="rv-confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: p.shape === "circle" ? "50%" : "2px",
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}
