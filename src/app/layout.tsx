// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell.client";

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
      style={{ backgroundColor: "var(--bg, #0c1426)" }}
    >
      <body
        className="min-h-screen bg-[var(--bg,#0c1426)] text-[var(--text,#f2f6ff)]"
        style={{
          backgroundColor: "var(--bg, #0c1426)",
          color: "var(--text, #f2f6ff)",
        }}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
