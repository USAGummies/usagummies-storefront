import "server-only";
import { storefrontFetch } from "./storefront";
import type { Review } from "@/components/home/ReviewsSection.client";

type RawMetaobject = {
  id: string;
  updatedAt: string;
  fields: Array<{ key: string; value: string }>;
};

function getField(meta: RawMetaobject, key: string) {
  return meta.fields.find((f) => f.key === key)?.value;
}

function hasShopifyEnv() {
  const domain =
    process.env.SHOPIFY_STORE_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    process.env.SHOPIFY_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN;

  const token =
    process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN ||
    process.env.SHOPIFY_STOREFRONT_API_TOKEN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN;

  return Boolean(domain && token);
}

export async function fetchVerifiedReviews(): Promise<Review[]> {
  if (process.env.SKIP_SHOPIFY_FETCH === "1") return [];
  if (!hasShopifyEnv()) return [];

  const query = /* GraphQL */ `
    query VerifiedReviews($first: Int!) {
      metaobjects(type: "review", first: $first) {
        nodes {
          id
          updatedAt
          fields {
            key
            value
          }
        }
      }
    }
  `;

  const data = await storefrontFetch<{ metaobjects: { nodes: RawMetaobject[] } }>({
    query,
    variables: { first: 100 },
    revalidate: 300,
    tags: ["shopify-reviews"],
  });

  if (!data?.metaobjects?.nodes?.length) return [];

  return data.metaobjects.nodes
    .map((node) => {
      const verified = (getField(node, "verified") || "").toLowerCase() === "true";
      if (!verified) return null;

      const rating = Number(getField(node, "rating"));
      if (!Number.isFinite(rating)) return null;

      const body = getField(node, "body") || "";
      if (!body) return null;

      const dateISO = getField(node, "dateISO") || node.updatedAt;
      if (!dateISO || Number.isNaN(new Date(dateISO).getTime())) return null;

      const helpfulCountRaw = getField(node, "helpfulCount");
      const featuredRaw = (getField(node, "featured") || "").toLowerCase();

      const review: Review = {
        id: node.id,
        source: "shopify",
        rating,
        title: getField(node, "title") || undefined,
        body,
        authorName: getField(node, "authorName") || "Customer",
        dateISO,
        productLabel: getField(node, "productLabel") || "All American Gummy Bears",
        verified: true,
        helpfulCount: helpfulCountRaw && Number.isFinite(Number(helpfulCountRaw))
          ? Number(helpfulCountRaw)
          : undefined,
        featured: featuredRaw === "true" || featuredRaw === "1" || featuredRaw === "yes",
      };

      return review;
    })
    .filter(Boolean) as Review[];
}
