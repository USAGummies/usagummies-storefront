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

export function GET() {
  const siteUrl = resolveSiteUrl();
  const host = new URL(siteUrl).host;
  const body = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /_next/
Disallow: /__seo
Disallow: /routecheck
Disallow: /command-center

Sitemap: ${siteUrl}/sitemap.xml
Host: ${host}

# LLM-friendly brand & product description
# See https://llmstxt.org
LLMs-Txt: ${siteUrl}/llms.txt
`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
