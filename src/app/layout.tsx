// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { Oswald, Space_Grotesk, Yellowtail } from "next/font/google";
import { AppShell } from "@/components/layout/AppShell.client";
import { AMAZON_LISTING_URL } from "@/lib/amazon";

function resolveSiteUrl() {
  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    null;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return "https://www.usagummies.com";
}

const SITE_URL = resolveSiteUrl();
const DEFAULT_DESCRIPTION = "Premium American-made gummy bears.";

const display = Oswald({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const sans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const script = Yellowtail({
  subsets: ["latin"],
  variable: "--font-script",
  weight: ["400"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "USA Gummies",
    template: "%s | USA Gummies",
  },
  description: DEFAULT_DESCRIPTION,
  openGraph: {
    title: "USA Gummies",
    description: DEFAULT_DESCRIPTION,
    url: SITE_URL,
    siteName: "USA Gummies",
    type: "website",
    images: [{ url: "/opengraph-image" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "USA Gummies",
    description: DEFAULT_DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const siteUrl = SITE_URL;
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteUrl}#organization`,
    name: "USA Gummies",
    url: siteUrl,
    logo: `${siteUrl}/brand/logo.png`,
    sameAs: [
      "https://www.instagram.com/usagummies/",
      AMAZON_LISTING_URL,
    ],
  };
  const webSiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl}#website`,
    name: "USA Gummies",
    url: siteUrl,
    publisher: { "@id": `${siteUrl}#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: `${siteUrl}/shop?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };

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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteJsonLd) }}
        />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
