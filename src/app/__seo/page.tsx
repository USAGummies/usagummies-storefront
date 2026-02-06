import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "SEO Debug | USA Gummies",
  robots: { index: false, follow: false },
};

function resolveSiteUrl() {
  const preferred = "https://www.usagummies.com";
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || null;
  const nodeEnv = (process.env.NODE_ENV as string | undefined) || "";
  if (fromEnv && fromEnv.includes("usagummies.com")) return fromEnv.replace(/\/$/, "");
  if (nodeEnv === "production") return preferred;
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return nodeEnv === "production" ? preferred : "http://localhost:3000";
}

export default function SeoDebugPage() {
  const nodeEnv = (process.env.NODE_ENV as string | undefined) || "";
  if (nodeEnv === "production") return notFound();

  const siteUrl = resolveSiteUrl();
  const canonicalShop = `${siteUrl}/shop`;
  const sampleHandle = "sample-product-handle";
  const canonicalProduct = `${siteUrl}/products/${sampleHandle}`;

  return (
    <main className="min-h-screen home-hero-theme text-[var(--text)]" style={{ padding: "24px", fontFamily: "Inter, sans-serif" }}>
      <h1 style={{ fontSize: "20px", fontWeight: 800, marginBottom: "16px" }}>SEO Debug (dev-only)</h1>
      <div style={{ display: "grid", gap: "10px" }}>
        <div>
          <strong>NODE_ENV:</strong> {nodeEnv}
        </div>
        <div>
          <strong>Resolved site URL:</strong> {siteUrl}
        </div>
        <div>
          <strong>Canonical /shop:</strong> {canonicalShop}
        </div>
        <div>
          <strong>Canonical product (sample):</strong> {canonicalProduct}
        </div>
      </div>
    </main>
  );
}
