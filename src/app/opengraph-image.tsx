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
const HERO_IMAGE_URL = `${SITE_URL}/brand/hero-pack-icon.png`;
const LOGO_IMAGE_URL = `${SITE_URL}/brand/logo.png`;

export default async function OpenGraphImage() {
  const [heroRes, logoRes] = await Promise.all([
    fetch(HERO_IMAGE_URL).catch(() => null),
    fetch(LOGO_IMAGE_URL).catch(() => null),
  ]);
  const heroImage = heroRes && heroRes.ok ? await heroRes.arrayBuffer() : null;
  const logoImage = logoRes && logoRes.ok ? await logoRes.arrayBuffer() : null;
  const heroSrc = heroImage ?? HERO_IMAGE_URL;
  const logoSrc = logoImage ?? LOGO_IMAGE_URL;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: "#f8f5ef",
          color: "#0d1c33",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "radial-gradient(circle at 15% 20%, rgba(199, 160, 98, 0.35), transparent 45%), radial-gradient(circle at 85% 10%, rgba(214, 69, 61, 0.18), transparent 42%)",
            opacity: 0.8,
          }}
        />
        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            width: "100%",
            height: "100%",
            padding: "64px",
            gap: "40px",
            alignItems: "center",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: "18px",
            }}
          >
            <div
              style={{
                fontSize: "16px",
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                color: "#5f5b56",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <img
                src={logoSrc as any}
                width={120}
                height={40}
                style={{ objectFit: "contain" }}
              />
              Made in USA
            </div>
            <div
              style={{
                fontSize: "70px",
                fontWeight: 800,
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
              }}
            >
              All-American Gummy Bears
            </div>
            <div
              style={{
                fontSize: "28px",
                color: "#1c2430",
                lineHeight: 1.25,
              }}
            >
              1-4 bags ship free with Amazon. 5+ bags ship free direct.
            </div>
            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
              <div
                style={{
                  padding: "10px 16px",
                  borderRadius: "999px",
                  backgroundColor: "#ffffff",
                  border: "2px solid rgba(13, 28, 51, 0.2)",
                  fontSize: "18px",
                  fontWeight: 700,
                }}
              >
                Free shipping on 5+ bags
              </div>
              <div style={{ fontSize: "16px", color: "#5f5b56" }}>
                No artificial dyes
              </div>
            </div>
          </div>
          <div
            style={{
              width: "320px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: "300px",
                height: "420px",
                borderRadius: "32px",
                overflow: "hidden",
                border: "2px solid #0d1c33",
                backgroundColor: "#ffffff",
                display: "flex",
                flexDirection: "column",
                boxShadow: "0 18px 40px rgba(15, 27, 45, 0.18)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <img
                src={heroSrc as any}
                width={260}
                height={360}
                style={{ objectFit: "contain" }}
              />
            </div>
          </div>
        </div>
      </div>
    ),
    size
  );
}
