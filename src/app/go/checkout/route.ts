// /go/checkout — creates a Storefront API cart and redirects to the Shopify
// checkout URL directly (bypasses the Shop Pay / shop.app redirect).
//
// Supports ?qty=N parameter (default: 5). Clamped to 1–12.
import { NextRequest, NextResponse } from "next/server";

const STOREFRONT_ENDPOINT =
  process.env.SHOPIFY_STOREFRONT_API_ENDPOINT ||
  "https://usa-gummies.myshopify.com/api/2025-01/graphql.json";
const STOREFRONT_TOKEN =
  process.env.SHOPIFY_STOREFRONT_API_TOKEN ||
  process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_TOKEN ||
  "";

const VARIANT_GID = "gid://shopify/ProductVariant/62295921099123";
const DEFAULT_QTY = 5;

const CART_CREATE_WITH_LINES = /* GraphQL */ `
  mutation CartCreate($lines: [CartLineInput!]!) {
    cartCreate(input: { lines: $lines }) {
      cart {
        checkoutUrl
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function fallbackPermalink(qty: number) {
  return `https://usa-gummies.myshopify.com/cart/62295921099123:${qty}`;
}

export async function GET(req: NextRequest) {
  const rawQty = req.nextUrl.searchParams.get("qty");
  const qty = rawQty ? Math.max(1, Math.min(12, Math.floor(Number(rawQty)) || DEFAULT_QTY)) : DEFAULT_QTY;

  if (!STOREFRONT_TOKEN) {
    return NextResponse.redirect(fallbackPermalink(qty), 302);
  }

  try {
    const res = await fetch(STOREFRONT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": STOREFRONT_TOKEN,
      },
      body: JSON.stringify({
        query: CART_CREATE_WITH_LINES,
        variables: {
          lines: [{ merchandiseId: VARIANT_GID, quantity: qty }],
        },
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.redirect(fallbackPermalink(qty), 302);
    }

    const json = await res.json();
    const checkoutUrl = json?.data?.cartCreate?.cart?.checkoutUrl;

    if (!checkoutUrl) {
      return NextResponse.redirect(fallbackPermalink(qty), 302);
    }

    return NextResponse.redirect(checkoutUrl, 302);
  } catch {
    return NextResponse.redirect(fallbackPermalink(qty), 302);
  }
}
