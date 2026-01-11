// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import { AppShell } from "@/components/layout/AppShell.client";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700", "800", "900"],
});

const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"],
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
      className={`${display.variable} ${sans.variable}`}
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
