// src/lib/cart.ts
import { cookies } from "next/headers";
import { shopifyRequest } from "./shopify/fetch";
import { normalizeSingleBagVariant } from "@/lib/bundles/atomic";
import { normalizeCheckoutUrl } from "@/lib/checkout";

const CART_COOKIE = "cartId";
const DEFAULT_STOREFRONT_API_VERSION = "2024-07";

function getShopifyEndpoint() {
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

function getShopifyToken() {
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

async function shopify<T>(query: string, variables?: Record<string, any>): Promise<T | null> {
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

async function shopifyResult<T>(query: string, variables?: Record<string, any>) {
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

const CART_CREATE = /* GraphQL */ `
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

const CART_GET = /* GraphQL */ `
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

const CART_LINES_ADD = /* GraphQL */ `
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

const CART_LINES_UPDATE = /* GraphQL */ `
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

type CartCreateResult = {
  cartCreate: {
    cart: { id: string; checkoutUrl: string; totalQuantity: number } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
};

type CartGetResult = {
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

type CartLinesAddResult = {
  cartLinesAdd: {
    cart: { id: string; checkoutUrl: string; totalQuantity: number } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
};

type CartLinesUpdateResult = {
  cartLinesUpdate: {
    cart: { id: string; checkoutUrl: string; totalQuantity: number } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
};

async function createCartId(): Promise<string> {
  const result = await shopifyResult<CartCreateResult>(CART_CREATE);
  if (!result.ok) {
    throw new Error(result.error || "Cart create failed.");
  }

  const cart = result.data?.cartCreate?.cart;
  const errs = result.data?.cartCreate?.userErrors;
  if (errs?.length) {
    const message = errs.map((err) => err.message).filter(Boolean).join("; ");
    throw new Error(message || "Cart create failed.");
  }
  if (!cart?.id) {
    throw new Error("Cart create failed.");
  }

  const jar = await cookies();
  jar.set(CART_COOKIE, cart.id, { path: "/", httpOnly: true, sameSite: "lax" });

  return cart.id;
}

async function getOrCreateCartId({
  throwOnError = false,
}: {
  throwOnError?: boolean;
} = {}): Promise<string | null> {
  const jar = await cookies();
  const existing = jar.get(CART_COOKIE)?.value;
  if (existing) return existing;
  try {
    return await createCartId();
  } catch (err) {
    if (throwOnError) throw err;
    return null;
  }
}

async function getCartById(cartId: string) {
  if (!cartId) return null;
  const data = await shopify<CartGetResult>(CART_GET, { cartId });
  const cart = data?.cart ?? null;
  if (!cart?.checkoutUrl) return cart;
  const normalized = normalizeCheckoutUrl(cart.checkoutUrl);
  return normalized ? { ...cart, checkoutUrl: normalized } : cart;
}

export async function getCart() {
  "use server";
  const jar = await cookies();
  const cartId = jar.get(CART_COOKIE)?.value;
  if (!cartId) return null;

  return getCartById(cartId);
}

export async function addToCart(variantId: string, quantity: number) {
  "use server";
  const safeVariantId = normalizeSingleBagVariant(variantId);
  if (!safeVariantId) {
    throw new Error("Only the single-bag variant can be added to cart.");
  }
  const cartId = await getOrCreateCartId({ throwOnError: true });
  if (!cartId) {
    throw new Error("Cart unavailable.");
  }

  const result = await shopifyResult<CartLinesAddResult>(CART_LINES_ADD, {
    cartId,
    lines: [{ merchandiseId: safeVariantId, quantity }],
  });
  if (!result.ok) {
    throw new Error(result.error || "Cart add failed.");
  }

  const errs = result.data?.cartLinesAdd?.userErrors;
  if (errs?.length) {
    const message = errs.map((err) => err.message).filter(Boolean).join("; ");
    throw new Error(message || "Cart add failed.");
  }

  const cart = result.data?.cartLinesAdd?.cart;
  if (cart?.id) {
    const jar = await cookies();
    jar.set(CART_COOKIE, cart.id, { path: "/", httpOnly: true, sameSite: "lax" });
    return cart.id;
  }
  throw new Error("Cart unavailable.");
}

export async function buyNow(variantId: string, quantity: number) {
  "use server";
  const safeVariantId = normalizeSingleBagVariant(variantId);
  if (!safeVariantId) {
    throw new Error("Only the single-bag variant can be purchased.");
  }
  const cartId = await getOrCreateCartId();
  if (!cartId) return null;

  const result = await shopifyResult<CartLinesAddResult>(CART_LINES_ADD, {
    cartId,
    lines: [{ merchandiseId: safeVariantId, quantity }],
  });
  if (!result.ok) return null;

  const errs = result.data?.cartLinesAdd?.userErrors;
  if (errs?.length) return null;

  const cart = result.data?.cartLinesAdd?.cart;
  if (!cart?.checkoutUrl) return null;
  const normalized = normalizeCheckoutUrl(cart.checkoutUrl);
  return normalized ?? cart.checkoutUrl;
}

export async function updateLineQuantity(lineId: string, quantity: number) {
  "use server";
  const cartId = await getOrCreateCartId();
  if (!cartId) return null;

  const nextQty = Math.max(0, Math.min(99, quantity));

  const data = await shopify<CartLinesUpdateResult>(CART_LINES_UPDATE, {
    cartId,
    lines: [{ id: lineId, quantity: nextQty }],
  });

  const errs = data?.cartLinesUpdate?.userErrors;
  if (errs?.length) return null;

  const cart = data?.cartLinesUpdate?.cart;
  if (cart?.id) {
    const jar = await cookies();
    jar.set(CART_COOKIE, cart.id, { path: "/", httpOnly: true, sameSite: "lax" });
    return cart.id;
  }
  return null;
}

/**
 * ✅ AOV lever: Replace the cart contents with ONE specific variant (bundle),
 * by zeroing existing lines, then adding the new one.
 */
export async function replaceCartWithVariant(variantId: string, quantity: number) {
  "use server";
  const safeVariantId = normalizeSingleBagVariant(variantId);
  if (!safeVariantId) {
    throw new Error("Only the single-bag variant can be used for bundles.");
  }
  const cartId = await getOrCreateCartId();
  if (!cartId) return null;

  // Read cart to get line IDs
  const data = await shopify<CartGetResult>(CART_GET, { cartId });
  const cart = data?.cart;

  // Clear existing lines (set qty=0)
  const lineUpdates =
    cart?.lines?.edges?.map((e) => ({ id: e.node.id, quantity: 0 })) ?? [];

  if (lineUpdates.length) {
    const cleared = await shopify<CartLinesUpdateResult>(CART_LINES_UPDATE, {
      cartId,
      lines: lineUpdates,
    });

    const errs = cleared?.cartLinesUpdate?.userErrors;
    if (errs?.length) return null;
  }

  // Add the target variant
  const nextQty = Math.max(1, Math.min(99, Number(quantity) || 1));
  const added = await shopify<CartLinesAddResult>(CART_LINES_ADD, {
    cartId,
    lines: [{ merchandiseId: safeVariantId, quantity: nextQty }],
  });

  const errs2 = added?.cartLinesAdd?.userErrors;
  if (errs2?.length) return null;

  const nextCart = added?.cartLinesAdd?.cart;
  if (nextCart?.id) {
    const jar = await cookies();
    jar.set(CART_COOKIE, nextCart.id, { path: "/", httpOnly: true, sameSite: "lax" });
    return nextCart.id;
  }
  return null;
}

export { getCartById };
