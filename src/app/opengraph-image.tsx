import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const contentType = "image/png";
export const size = {
  width: 1200,
  height: 630,
};

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.SITE_URL ||
  "https://www.usagummies.com";

async function fetchImageAsBase64(url: string, mime = "image/png") {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function OpenGraphImage() {
  const [logoSrc, heroSrc] = await Promise.all([
    fetchImageAsBase64(`${SITE_URL}/brand/logo-full.png`, "image/png"),
    fetchImageAsBase64(`${SITE_URL}/brand/hero.jpg`, "image/jpeg"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: "#f8f5ef",
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 60px",
          gap: "50px",
        }}
      >
        {/* Left side: product image */}
        {heroSrc && (
          <div
            style={{
              display: "flex",
              width: "420px",
              height: "520px",
              borderRadius: "24px",
              overflow: "hidden",
              flexShrink: 0,
              boxShadow: "0 20px 60px rgba(27, 42, 74, 0.15)",
            }}
          >
            <img
              src={heroSrc}
              alt=""
              width={420}
              height={520}
              style={{
                objectFit: "cover",
                objectPosition: "center",
                width: "100%",
                height: "100%",
              }}
            />
          </div>
        )}

        {/* Right side: branding */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "center",
            flex: 1,
            gap: "20px",
          }}
        >
          {/* Logo */}
          {logoSrc && (
            <img
              src={logoSrc}
              alt=""
              width={460}
              height={180}
              style={{
                objectFit: "contain",
                objectPosition: "left center",
              }}
            />
          )}

          {/* Tagline */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div
              style={{
                fontSize: "32px",
                fontWeight: 700,
                color: "#1B2A4A",
                lineHeight: 1.2,
                letterSpacing: "-0.01em",
              }}
            >
              All American Gummy Bears
            </div>
            <div
              style={{
                fontSize: "22px",
                fontWeight: 400,
                color: "#5f5b56",
                lineHeight: 1.4,
              }}
            >
              All natural. No artificial dyes. Made in the USA.
            </div>
          </div>

          {/* Flavor dots row */}
          <div
            style={{
              display: "flex",
              gap: "12px",
              marginTop: "8px",
            }}
          >
            {["#c7362c", "#e8742a", "#f5c842", "#2D7A3A", "#a03050"].map(
              (color) => (
                <div
                  key={color}
                  style={{
                    width: "24px",
                    height: "24px",
                    borderRadius: "50%",
                    backgroundColor: color,
                  }}
                />
              )
            )}
          </div>

          {/* URL */}
          <div
            style={{
              fontSize: "18px",
              fontWeight: 600,
              color: "#c7a062",
              letterSpacing: "0.05em",
              marginTop: "4px",
            }}
          >
            usagummies.com
          </div>
        </div>
      </div>
    ),
    size
  );
}
