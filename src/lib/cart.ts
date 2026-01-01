// src/lib/cart.ts
import { cookies } from "next/headers";

const CART_COOKIE = "cartId";

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

async function shopify<T>(query: string, variables?: Record<string, any>): Promise<T> {
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
    cache: "no-store",
  });

  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join(" | "));
  if (!json.data) throw new Error("No data returned from Shopify.");
  return json.data;
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
  const data = await shopify<CartCreateResult>(CART_CREATE);

  const errs = data.cartCreate.userErrors;
  if (errs?.length) throw new Error(errs.map((e) => e.message).join(" | "));

  const cart = data.cartCreate.cart;
  if (!cart?.id) throw new Error("Failed to create cart.");

  const jar = await cookies();
  jar.set(CART_COOKIE, cart.id, { path: "/", httpOnly: true, sameSite: "lax" });

  return cart.id;
}

async function getOrCreateCartId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(CART_COOKIE)?.value;
  if (existing) return existing;
  return createCartId();
}

export async function getCart() {
  "use server";
  const jar = await cookies();
  const cartId = jar.get(CART_COOKIE)?.value;
  if (!cartId) return null;

  const data = await shopify<CartGetResult>(CART_GET, { cartId });
  return data.cart;
}

export async function addToCart(variantId: string, quantity: number) {
  "use server";
  const cartId = await getOrCreateCartId();

  const data = await shopify<CartLinesAddResult>(CART_LINES_ADD, {
    cartId,
    lines: [{ merchandiseId: variantId, quantity }],
  });

  const errs = data.cartLinesAdd.userErrors;
  if (errs?.length) throw new Error(errs.map((e) => e.message).join(" | "));

  const cart = data.cartLinesAdd.cart;
  if (cart?.id) {
    const jar = await cookies();
    jar.set(CART_COOKIE, cart.id, { path: "/", httpOnly: true, sameSite: "lax" });
  }
}

export async function buyNow(variantId: string, quantity: number) {
  "use server";
  const cartId = await getOrCreateCartId();

  const data = await shopify<CartLinesAddResult>(CART_LINES_ADD, {
    cartId,
    lines: [{ merchandiseId: variantId, quantity }],
  });

  const errs = data.cartLinesAdd.userErrors;
  if (errs?.length) throw new Error(errs.map((e) => e.message).join(" | "));

  const cart = data.cartLinesAdd.cart;
  if (!cart?.checkoutUrl) throw new Error("Missing checkoutUrl from Shopify cart.");
  return cart.checkoutUrl;
}

export async function updateLineQuantity(lineId: string, quantity: number) {
  "use server";
  const cartId = await getOrCreateCartId();

  const nextQty = Math.max(0, Math.min(99, quantity));

  const data = await shopify<CartLinesUpdateResult>(CART_LINES_UPDATE, {
    cartId,
    lines: [{ id: lineId, quantity: nextQty }],
  });

  const errs = data.cartLinesUpdate.userErrors;
  if (errs?.length) throw new Error(errs.map((e) => e.message).join(" | "));

  const cart = data.cartLinesUpdate.cart;
  if (cart?.id) {
    const jar = await cookies();
    jar.set(CART_COOKIE, cart.id, { path: "/", httpOnly: true, sameSite: "lax" });
  }
}

/**
 * ✅ AOV lever: Replace the cart contents with ONE specific variant (bundle),
 * by zeroing existing lines, then adding the new one.
 */
export async function replaceCartWithVariant(variantId: string, quantity: number) {
  "use server";
  const cartId = await getOrCreateCartId();

  // Read cart to get line IDs
  const data = await shopify<CartGetResult>(CART_GET, { cartId });
  const cart = data.cart;

  // Clear existing lines (set qty=0)
  const lineUpdates =
    cart?.lines?.edges?.map((e) => ({ id: e.node.id, quantity: 0 })) ?? [];

  if (lineUpdates.length) {
    const cleared = await shopify<CartLinesUpdateResult>(CART_LINES_UPDATE, {
      cartId,
      lines: lineUpdates,
    });

    const errs = cleared.cartLinesUpdate.userErrors;
    if (errs?.length) throw new Error(errs.map((e) => e.message).join(" | "));
  }

  // Add the target variant
  const nextQty = Math.max(1, Math.min(99, Number(quantity) || 1));
  const added = await shopify<CartLinesAddResult>(CART_LINES_ADD, {
    cartId,
    lines: [{ merchandiseId: variantId, quantity: nextQty }],
  });

  const errs2 = added.cartLinesAdd.userErrors;
  if (errs2?.length) throw new Error(errs2.map((e) => e.message).join(" | "));

  const nextCart = added.cartLinesAdd.cart;
  if (nextCart?.id) {
    const jar = await cookies();
    jar.set(CART_COOKIE, nextCart.id, { path: "/", httpOnly: true, sameSite: "lax" });
  }
}
