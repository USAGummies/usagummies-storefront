// /go/checkout — creates a Storefront API cart and redirects to the Shopify
// checkout URL directly (bypasses the Shop Pay / shop.app redirect).
//
// Supports ?qty=N parameter (default: 5). Clamped to 1–12.
//
// Also fires a server-side GA4 event via Measurement Protocol so we get
// 100% accurate checkout-redirect counts regardless of ad blockers.
import { NextRequest, NextResponse } from "next/server";
import { SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";

const STOREFRONT_API_VERSION = "2025-01";
const STOREFRONT_ENDPOINT =
  process.env.SHOPIFY_STOREFRONT_API_ENDPOINT ||
  `https://usa-gummies.myshopify.com/api/${STOREFRONT_API_VERSION}/graphql.json`;
const STOREFRONT_TOKEN =
  process.env.SHOPIFY_STOREFRONT_API_TOKEN ||
  process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_TOKEN ||
  "";
const GA4_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA4_ID?.trim() || "G-31X673PSVY";
const GA4_API_SECRET = process.env.GA4_API_SECRET?.trim();
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

/** Extract numeric ID from GID for Shopify cart permalink */
const NUMERIC_VARIANT_ID = SINGLE_BAG_VARIANT_ID.split("/").pop()!;

function fallbackPermalink(qty: number) {
  return `https://usa-gummies.myshopify.com/cart/${NUMERIC_VARIANT_ID}:${qty}`;
}

/** Fire-and-forget GA4 Measurement Protocol event */
function fireGA4Event(
  eventName: string,
  params: Record<string, string | number>,
  req: NextRequest,
) {
  if (!GA4_API_SECRET || !GA4_MEASUREMENT_ID) return;

  // Try to extract GA4 client ID from _ga cookie
  let clientId = "";
  const gaCookie = req.cookies.get("_ga")?.value;
  if (gaCookie) {
    const parts = gaCookie.split(".");
    if (parts.length >= 4) clientId = `${parts[2]}.${parts[3]}`;
  }
  if (!clientId) {
    // Fallback: hash IP + UA
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const ua = req.headers.get("user-agent") || "unknown";
    let hash = 0;
    const str = `${ip}|${ua}`;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    clientId = `${Math.abs(hash)}.${Math.floor(Date.now() / 1000)}`;
  }

  fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        events: [{ name: eventName, params }],
      }),
    },
  ).catch(() => {});
}

export async function GET(req: NextRequest) {
  const rawQty = req.nextUrl.searchParams.get("qty");
  const qty = rawQty ? Math.max(1, Math.min(12, Math.floor(Number(rawQty)) || DEFAULT_QTY)) : DEFAULT_QTY;

  // Server-side tracking — 100% accurate, no ad blocker can stop this
  fireGA4Event("go_checkout_redirect", { qty, page_path: "/go/checkout" }, req);
  console.info("go_checkout_redirect", { qty });

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
          lines: [{ merchandiseId: SINGLE_BAG_VARIANT_ID, quantity: qty }],
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
