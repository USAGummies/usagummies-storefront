// /lp/* — scoped layout for paid-traffic landing pages.
// Pulls its own fonts and applies .lp-scope so the rest of the site is untouched.
import type { Metadata, Viewport } from "next";
import { Alfa_Slab_One, Fraunces, IBM_Plex_Mono } from "next/font/google";
import "@/styles/lp.css";

const display = Alfa_Slab_One({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-lp-display",
  display: "swap",
});

const editorial = Fraunces({
  subsets: ["latin"],
  variable: "--font-lp-editorial",
  display: "swap",
  axes: ["opsz", "SOFT"],
});

const mono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-lp-mono",
  display: "swap",
});

export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0f0d0b",
  colorScheme: "light",
};

export default function LpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`lp-scope lp-grain ${display.variable} ${editorial.variable} ${mono.variable}`}
    >
      {children}
    </div>
  );
}
