// /go/checkout — creates a Storefront API cart with 5 bags and redirects
// to the Shopify checkout URL directly (bypasses Shop Pay redirect).
import { NextResponse } from "next/server";

const STOREFRONT_ENDPOINT =
  process.env.SHOPIFY_STOREFRONT_API_ENDPOINT ||
  "https://usa-gummies.myshopify.com/api/2025-01/graphql.json";
const STOREFRONT_TOKEN =
  process.env.SHOPIFY_STOREFRONT_API_TOKEN ||
  process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_TOKEN ||
  "";

const VARIANT_GID = "gid://shopify/ProductVariant/62295921099123";
const QUANTITY = 5;

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

// Fallback if the API checkout fails
const CART_PERMALINK =
  "https://usa-gummies.myshopify.com/cart/62295921099123:5";

export async function GET() {
  if (!STOREFRONT_TOKEN) {
    return NextResponse.redirect(CART_PERMALINK, 302);
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
          lines: [{ merchandiseId: VARIANT_GID, quantity: QUANTITY }],
        },
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.redirect(CART_PERMALINK, 302);
    }

    const json = await res.json();
    const checkoutUrl = json?.data?.cartCreate?.cart?.checkoutUrl;

    if (!checkoutUrl) {
      return NextResponse.redirect(CART_PERMALINK, 302);
    }

    return NextResponse.redirect(checkoutUrl, 302);
  } catch {
    return NextResponse.redirect(CART_PERMALINK, 302);
  }
}
