import type { Metadata } from "next";
import { redirect } from "next/navigation";

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

const SITE_URL = resolveSiteUrl();
const OG_IMAGE = "/opengraph-image";
const SHOP_TITLE = "Shop USA Gummies | Buy More, Save More on American-Made Gummies";
const SHOP_DESCRIPTION =
  "Explore USA Gummies bag count savings and best sellers. Made in the USA, all natural, dye-free. Free shipping on 5+ bags.";

export async function generateMetadata(): Promise<Metadata> {
  const canonical = `${SITE_URL}/shop`;
  return {
    title: SHOP_TITLE,
    description: SHOP_DESCRIPTION,
    alternates: { canonical },
    openGraph: {
      title: SHOP_TITLE,
      description: SHOP_DESCRIPTION,
      url: canonical,
      images: [{ url: OG_IMAGE }],
    },
    twitter: {
      card: "summary_large_image",
      title: SHOP_TITLE,
      description: SHOP_DESCRIPTION,
      images: [OG_IMAGE],
    },
  };
}

export default async function ProductPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await props.searchParams) ?? {};
  const anchor = sp.focus === "bundles" ? "#product-bundles" : "#product-details";

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (!value || key === "focus") continue;
    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, v));
    } else {
      params.set(key, value);
    }
  }

  const query = params.toString();
  redirect(`/shop${query ? `?${query}` : ""}${anchor}`);
}
