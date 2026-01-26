import { notFound } from "next/navigation";

function resolveSiteUrl() {
  const preferred = "https://www.usagummies.com";
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || null;
  if (fromEnv && fromEnv.includes("usagummies.com")) return fromEnv.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") return preferred;
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return preferred;
}

export default function SeoDebugPage() {
  if (process.env.NODE_ENV === "production") return notFound();

  const siteUrl = resolveSiteUrl();
  const canonicalShop = `${siteUrl}/shop`;
  const sampleHandle = "sample-product-handle";
  const canonicalProduct = `${siteUrl}/products/${sampleHandle}`;

  return (
    <main style={{ padding: "24px", fontFamily: "Inter, sans-serif" }}>
      <h1 style={{ fontSize: "20px", fontWeight: 800, marginBottom: "16px" }}>SEO Debug (dev-only)</h1>
      <div style={{ display: "grid", gap: "10px" }}>
        <div>
          <strong>NODE_ENV:</strong> {process.env.NODE_ENV}
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
