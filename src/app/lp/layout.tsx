// /lp/* — scoped layout for paid-traffic landing pages.
// Pulls its own fonts and applies .lp-scope so the rest of the site is untouched.
import type { Metadata, Viewport } from "next";
import { Ultra, Oswald, Yellowtail } from "next/font/google";
import "@/styles/lp.css";

// Ultra — chunky slab display, matches the "USA GUMMIES" wordmark on the bag.
const display = Ultra({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-lp-display",
  display: "swap",
});

// Oswald — tall, patriotic condensed sans for body + labels.
const body = Oswald({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-lp-body",
  display: "swap",
});

// Yellowtail — the script accent for "Made in the U.S.A." tagline energy.
const script = Yellowtail({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-lp-script",
  display: "swap",
});

export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#CF2932",
  colorScheme: "light",
};

export default function LpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`lp-scope ${display.variable} ${body.variable} ${script.variable}`}
    >
      {children}
    </div>
  );
}
