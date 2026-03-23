import type { NextConfig } from "next";

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-site" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://assets.apollo.io https://va.vercel-scripts.com https://cdn.plaid.com",
      "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com https://aplo-evnt.com https://assets.apollo.io https://vitals.vercel-insights.com https://*.myshopify.com https://cdn.shopify.com https://cdn.plaid.com https://production.plaid.com",
      "frame-src 'self' https://cdn.plaid.com",
      "form-action 'self' https://*.myshopify.com",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [360, 420, 640, 750, 828, 1080, 1200, 1536, 1920, 2560, 3840],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.shopify.com",
        pathname: "/s/files/**",
      },
      {
        protocol: "https",
        hostname: "*.myshopify.com",
      },
      {
        protocol: "https",
        hostname: "*.cdninstagram.com",
      },
      {
        protocol: "https",
        hostname: "upload.wikimedia.org",
        pathname: "/wikipedia/commons/**",
      },
    ],
  },
  transpilePackages: ["next-mdx-remote"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/:path*.:ext(woff2|woff|ttf|otf)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/:path*.:ext(png|jpg|jpeg|webp|avif|gif|svg|ico)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },

  async redirects() {
    return [
      { source: "/terms", destination: "/policies/terms", permanent: true },
      { source: "/privacy", destination: "/policies/privacy", permanent: true },
      { source: "/shipping", destination: "/policies/shipping", permanent: true },
      { source: "/returns", destination: "/policies/returns", permanent: true },
      { source: "/store", destination: "/shop", permanent: true },
      { source: "/products", destination: "/shop", permanent: true },
      { source: "/subscribe", destination: "/shop", permanent: false },
      { source: "/rewards", destination: "/shop", permanent: false },
      { source: "/blog/rss.xml", destination: "/rss.xml", permanent: true },
    ];
  },
};

export default nextConfig;
