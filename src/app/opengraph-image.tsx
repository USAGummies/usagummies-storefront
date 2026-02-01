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
const HERO_IMAGE_URL = `${SITE_URL}/brand/hero.jpg`;

export default async function OpenGraphImage() {
  const heroRes = await fetch(HERO_IMAGE_URL).catch(() => null);
  const heroImage = heroRes && heroRes.ok ? await heroRes.arrayBuffer() : null;
  const heroSrc = heroImage
    ? `data:image/jpeg;base64,${Buffer.from(heroImage).toString("base64")}`
    : HERO_IMAGE_URL;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "stretch",
          justifyContent: "stretch",
          backgroundColor: "#f8f5ef",
          backgroundImage: `url(${heroSrc})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
    ),
    size
  );
}
