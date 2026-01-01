// src/lib/shopify/storefront.ts
import "server-only";

type ShopifyResponse<T> = { data?: T; errors?: Array<{ message: string }> };

function getShopifyEndpoint() {
  const explicit = process.env.SHOPIFY_STOREFRONT_API_ENDPOINT;
  if (explicit) return explicit;

  const domain =
    process.env.SHOPIFY_STORE_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    process.env.SHOPIFY_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN;

  const version =
    process.env.SHOPIFY_STOREFRONT_API_VERSION ||
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_VERSION;

  if (domain && version) {
    const clean = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${clean}/api/${version}/graphql.json`;
  }

  return undefined;
}

function getShopifyToken() {
  return (
    process.env.SHOPIFY_STOREFRONT_API_TOKEN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_TOKEN ||
    process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN
  );
}

const SHOPIFY_ENDPOINT = getShopifyEndpoint();
const SHOPIFY_TOKEN = getShopifyToken();

export async function storefrontFetch<T>({
  query,
  variables,
  tags = [],
  revalidate = 60,
}: {
  query: string;
  variables?: Record<string, any>;
  tags?: string[];
  revalidate?: number;
}): Promise<T> {
  if (!SHOPIFY_ENDPOINT) {
    throw new Error(
      "Missing Shopify endpoint. Set SHOPIFY_STOREFRONT_API_ENDPOINT OR (SHOPIFY_STORE_DOMAIN + SHOPIFY_STOREFRONT_API_VERSION)."
    );
  }
  if (!SHOPIFY_TOKEN) {
    throw new Error(
      "Missing Shopify token. Set SHOPIFY_STOREFRONT_API_TOKEN (or a supported token env var)."
    );
  }

  const res = await fetch(SHOPIFY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": SHOPIFY_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
    next: { revalidate, tags },
  });

  const json = (await res.json()) as ShopifyResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join(" | "));
  }
  if (!json.data) throw new Error("No data returned from Shopify.");
  return json.data;
}