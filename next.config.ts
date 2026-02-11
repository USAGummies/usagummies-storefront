import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [360, 420, 640, 750, 828, 1080, 1200, 1536, 1920],
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
      { source: "/blog/rss.xml", destination: "/rss.xml", permanent: true },
      // Google Search Console 404 cleanup
      { source: "/home", destination: "/", permanent: true },
      { source: "/contact-1", destination: "/contact", permanent: true },
      { source: "/store/p/all-american-gummy-bears-katzh", destination: "/shop", permanent: true },
      { source: "/store/p/all-american-gummy-bears", destination: "/shop", permanent: true },
      { source: "/blog/blog-post-title-four-6k8cc", destination: "/blog", permanent: true },
      { source: "/blog/category/Gummy\\+Bear\\+Tips", destination: "/blog", permanent: true },
    ];
  },
};

export default nextConfig;
