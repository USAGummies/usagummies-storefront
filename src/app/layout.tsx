// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/react";
import { Oswald, Space_Grotesk, Yellowtail } from "next/font/google";
import { AppShell } from "@/components/layout/AppShell.client";
import { AMAZON_LISTING_URL } from "@/lib/amazon";

const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID?.trim() || "G-31X673PSVY";
// Google Ads customer 775-414-2374 (account tied to ben@usagummies.com).
// AW-* remarketing tag = customer ID without dashes. Safe default so the base
// tag fires even if Vercel env is empty — enables audiences, view-through
// conversions, and enhanced-conversion payloads immediately. The conversion
// LABEL must still be set via NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL for
// purchase events to register as a specific conversion action.
const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID?.trim() || "AW-7754142374";
const GOOGLE_ADS_CONVERSION_LABEL = process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL?.trim() || "";
const GOOGLE_SITE_VERIFICATION = process.env.NEXT_PUBLIC_GSC_VERIFICATION?.trim();
const META_PIXEL_ID = "26033875762978520";
const CLARITY_ID = process.env.NEXT_PUBLIC_CLARITY_ID?.trim();

function GoogleAnalytics() {
  if (!GA4_ID) return null;
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA4_ID}', {
            send_page_view: true,
            linker: {
              domains: ['usagummies.com', 'www.usagummies.com', 'usa-gummies.myshopify.com'],
              decorate_forms: true,
              accept_incoming: true,
            },
          });
          ${GOOGLE_ADS_ID ? `gtag('config', '${GOOGLE_ADS_ID}', { allow_enhanced_conversions: true });` : ""}
          ${GOOGLE_ADS_ID && GOOGLE_ADS_CONVERSION_LABEL ? `window.__usaGadsConversionId = '${GOOGLE_ADS_ID}/${GOOGLE_ADS_CONVERSION_LABEL}';` : ""}
        `}
      </Script>
    </>
  );
}

function MicrosoftClarity() {
  if (!CLARITY_ID) return null;
  return (
    <Script id="clarity-init" strategy="afterInteractive">
      {`
        (function(c,l,a,r,i,t,y){
          c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
          t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
          y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
        })(window, document, "clarity", "script", "${CLARITY_ID}");
      `}
    </Script>
  );
}

function MetaPixel() {
  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${META_PIXEL_ID}');
          fbq('track', 'PageView');
        `}
      </Script>
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  );
}

function resolveSiteUrl() {
  const preferred = "https://www.usagummies.com";
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || null;
  const nodeEnv = (process.env.NODE_ENV as string | undefined) || "";
  if (fromEnv && fromEnv.includes("usagummies.com")) return fromEnv.replace(/\/$/, "");
  if (nodeEnv === "production") return preferred;
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (nodeEnv !== "production") return "http://localhost:3000";
  return preferred;
}

const SITE_URL = resolveSiteUrl();
const DEFAULT_DESCRIPTION = "All natural, American-made gummy bears with no artificial dyes.";

const display = Oswald({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "700"],
  display: "swap",
  preload: false,
});

const sans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "700"],
  display: "swap",
  preload: true,
});

const script = Yellowtail({
  subsets: ["latin"],
  variable: "--font-script",
  weight: ["400"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.usagummies.com"),
  title: {
    default: "USA Gummies",
    template: "%s | USA Gummies",
  },
  description: DEFAULT_DESCRIPTION,
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/brand/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "USA Gummies",
    description: DEFAULT_DESCRIPTION,
    url: SITE_URL,
    siteName: "USA Gummies",
    type: "website",
    images: [{ url: "/opengraph-image", alt: "USA Gummies gummy bear bag" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "USA Gummies",
    description: DEFAULT_DESCRIPTION,
    images: ["/opengraph-image"],
  },
  verification: GOOGLE_SITE_VERIFICATION
    ? {
        google: GOOGLE_SITE_VERIFICATION,
      }
    : undefined,
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
      "https://www.facebook.com/people/USA-Gummies/61581802793282/",
      "https://www.tiktok.com/@usa.gummies?lang=en",
      "https://www.youtube.com/@USAGummies",
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
      style={{ backgroundColor: "#f8f5ef" }}
    >
      <head>
        <link rel="preconnect" href="https://cdn.shopify.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://www.googletagmanager.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://www.google-analytics.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://assets.apollo.io" crossOrigin="anonymous" />
        <Script id="apollo-tracker" strategy="beforeInteractive">
          {`function initApollo(){var n=Math.random().toString(36).substring(7),o=document.createElement("script");o.src="https://assets.apollo.io/micro/website-tracker/tracker.iife.js?nocache="+n,o.async=!0,o.defer=!0,o.onload=function(){window.trackingFunctions.onLoad({appId:"697a8732160a9800112f9a5b"})},document.head.appendChild(o)}initApollo();`}
        </Script>
      </head>
      <body
        className="min-h-screen text-[var(--text,#1B2A4A)]"
      >
        <GoogleAnalytics />
        <MicrosoftClarity />
        <MetaPixel />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteJsonLd) }}
        />
        <AppShell>{children}</AppShell>
        <Analytics />
      </body>
    </html>
  );
}
