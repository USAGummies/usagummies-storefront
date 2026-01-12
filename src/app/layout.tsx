// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { Oswald, Space_Grotesk, Yellowtail } from "next/font/google";
import { AppShell } from "@/components/layout/AppShell.client";

const display = Oswald({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
});

const sans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

const script = Yellowtail({
  subsets: ["latin"],
  variable: "--font-script",
  weight: ["400"],
});

export const metadata: Metadata = {
  title: "USA Gummies",
  description: "Premium American-made gummy bears.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${script.variable}`}
      style={{ backgroundColor: "var(--bg, #f8f5ef)" }}
    >
      <body
        className="min-h-screen bg-[var(--bg,#f8f5ef)] text-[var(--text,#1c2430)]"
        style={{
          backgroundColor: "var(--bg, #f8f5ef)",
          color: "var(--text, #1c2430)",
        }}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
