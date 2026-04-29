// src/lib/cart.ts
//
// Pure cart helpers — no `next/headers`, no cookies, no server actions.
// Cookie-bound flows (getCart / addToCart / buyNow / updateLineQuantity /
// replaceCartWithVariant) live in `src/lib/cart.actions.ts` so they can
// be imported by client components without dragging next/headers across
// the server/client boundary.
import { shopifyRequest } from "./shopify/fetch";
import { normalizeCheckoutUrl } from "@/lib/checkout";

export const CART_COOKIE = "cartId";
const DEFAULT_STOREFRONT_API_VERSION = "2025-01";

export function getShopifyEndpoint() {
  const explicit = process.env.SHOPIFY_STOREFRONT_API_ENDPOINT;
  if (explicit) return { endpoint: explicit, source: "explicit" as const };

  const domain =
    process.env.SHOPIFY_STORE_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    process.env.SHOPIFY_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN;

  const version =
    process.env.SHOPIFY_STOREFRONT_API_VERSION ||
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_VERSION ||
    DEFAULT_STOREFRONT_API_VERSION;

  if (domain && version) {
    const clean = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return {
      endpoint: `https://${clean}/api/${version}/graphql.json`,
      source: "derived" as const,
    };
  }

  return { endpoint: undefined, source: "missing" as const };
}

export function getShopifyToken() {
  return (
    process.env.SHOPIFY_STOREFRONT_API_TOKEN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_TOKEN ||
    process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN
  );
}

export function getCartConfigStatus() {
  const { endpoint, source } = getShopifyEndpoint();
  const token = getShopifyToken();
  return {
    endpoint: Boolean(endpoint),
    token: Boolean(token),
    source,
  };
}

export async function shopify<T>(query: string, variables?: Record<string, any>): Promise<T | null> {
  const { endpoint } = getShopifyEndpoint();
  const token = getShopifyToken();
  if (!endpoint || !token) return null;
  const result = await shopifyRequest<T>({
    endpoint,
    token,
    body: { query, variables },
    cache: "no-store",
    warnPrefix: "Shopify cart",
  });

  return result.ok ? result.data : null;
}

export async function shopifyResult<T>(query: string, variables?: Record<string, any>) {
  const { endpoint } = getShopifyEndpoint();
  const token = getShopifyToken();
  if (!endpoint || !token) {
    return { ok: false, data: null, error: "missing config" } as const;
  }
  return shopifyRequest<T>({
    endpoint,
    token,
    body: { query, variables },
    cache: "no-store",
    warnPrefix: "Shopify cart",
  });
}

export const CART_CREATE = /* GraphQL */ `
  mutation CartCreate {
    cartCreate {
      cart {
        id
        checkoutUrl
        totalQuantity
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const CART_GET = /* GraphQL */ `
  query CartGet($cartId: ID!) {
    cart(id: $cartId) {
      id
      checkoutUrl
      totalQuantity
      cost {
        subtotalAmount {
          amount
          currencyCode
        }
      }
      lines(first: 100) {
        edges {
          node {
            id
            quantity
            merchandise {
              ... on ProductVariant {
                id
                title
                bundleQty: metafield(namespace: "custom", key: "bundle_qty") { value }
                bundleBags: metafield(namespace: "custom", key: "bundle_bags") { value }
                product {
                  title
                  handle
                }
                image {
                  url
                  altText
                  width
                  height
                }
                price {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const CART_LINES_ADD = /* GraphQL */ `
  mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart {
        id
        checkoutUrl
        totalQuantity
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const CART_LINES_UPDATE = /* GraphQL */ `
  mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
    cartLinesUpdate(cartId: $cartId, lines: $lines) {
      cart {
        id
        checkoutUrl
        totalQuantity
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export type CartCreateResult = {
  cartCreate: {
    cart: { id: string; checkoutUrl: string; totalQuantity: number } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
};

export type CartGetResult = {
  cart: {
    id: string;
    checkoutUrl: string;
    totalQuantity: number;
    cost: { subtotalAmount: { amount: string; currencyCode: string } };
    lines: {
      edges: Array<{
        node: {
          id: string;
          quantity: number;
          merchandise: {
            id: string;
            title: string;
            bundleQty: { value: string | null } | null;
            bundleBags: { value: string | null } | null;
            product: { title: string; handle: string };
            image: { url: string; altText: string | null; width: number; height: number } | null;
            price: { amount: string; currencyCode: string };
          };
        };
      }>;
    };
  } | null;
};

export type CartLinesAddResult = {
  cartLinesAdd: {
    cart: { id: string; checkoutUrl: string; totalQuantity: number } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
};

export type CartLinesUpdateResult = {
  cartLinesUpdate: {
    cart: { id: string; checkoutUrl: string; totalQuantity: number } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
};

export async function getCartById(cartId: string) {
  if (!cartId) return null;
  const data = await shopify<CartGetResult>(CART_GET, { cartId });
  const cart = data?.cart ?? null;
  if (!cart?.checkoutUrl) return cart;
  const normalized = normalizeCheckoutUrl(cart.checkoutUrl);
  return normalized ? { ...cart, checkoutUrl: normalized } : cart;
}
