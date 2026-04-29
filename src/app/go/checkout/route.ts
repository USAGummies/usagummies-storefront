// /go/checkout — creates a Storefront API cart and redirects to the Shopify
// checkout URL.
//
// 2026-04-28 UPDATE — Shop Pay re-enable: 6 InitiateCheckouts → 0 Purchases on
// 4/28 funnel. Root cause: Storefront API cartCreate cart URLs go through
// `shop.app` callback which appends `skip_shop_pay=true` to the final
// checkout URL, hiding the Shop Pay express checkout button (the highest-
// converting one-tap path). Fix: follow the cart→shop.app redirect server-
// side, extract the `ur_back_url` checkout target, strip skip_shop_pay=true,
// and redirect users directly there. Bypasses the shop.app domain hop AND
// restores the express button. Adds ~150ms server latency.
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
const TRUSTED_REFERRER_HOSTS = new Set([
  "usagummies.com",
  "www.usagummies.com",
]);
const ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "ttclid",
  "_gl",
] as const;
const GA4_ATTRIBUTION_KEYS = ATTRIBUTION_KEYS.filter((k) => k !== "_gl");

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

function fallbackPermalink(qty: number, attribution: URLSearchParams) {
  const url = new URL(`https://usa-gummies.myshopify.com/cart/${NUMERIC_VARIANT_ID}:${qty}`);
  for (const key of ATTRIBUTION_KEYS) {
    const value = attribution.get(key);
    if (!value || url.searchParams.has(key)) continue;
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * Resolve the Storefront-API-generated cart URL into a direct Shopify checkout
 * URL with `skip_shop_pay=true` stripped, so the Shop Pay express button is
 * visible at checkout. The cart URL on myshopify.com 302-redirects to a
 * `shop.app` callback URL whose `ur_back_url` query param contains the actual
 * checkout destination. We extract that, strip skip_shop_pay, and use it.
 *
 * If anything fails (network error, unexpected redirect chain, missing field),
 * the caller falls back to the original cart URL — at worst the user lands on
 * the same checkout they would have today (just with one extra hop through
 * shop.app). This wrapper never throws.
 */
async function resolveShopPayFriendlyCheckoutUrl(
  cartUrl: string,
): Promise<string> {
  try {
    const res = await fetch(cartUrl, {
      method: "GET",
      redirect: "manual",
      // Mimic a mobile browser so Shopify routes us through the same flow as
      // real ad-traffic visitors (shop.app callback chain).
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        Accept: "text/html",
      },
      cache: "no-store",
    });
    const location = res.headers.get("location");
    if (!location) return cartUrl;

    // The cart URL redirects to shop.app/checkout/.../shop_pay_callback?...&ur_back_url=...
    const parsed = new URL(location);
    if (!parsed.host.endsWith("shop.app")) {
      // Already on Shopify checkout host — strip skip_shop_pay if present and use.
      try {
        parsed.searchParams.delete("skip_shop_pay");
        return parsed.toString();
      } catch {
        return location;
      }
    }

    const urBackUrl = parsed.searchParams.get("ur_back_url");
    if (!urBackUrl) return cartUrl;

    // urBackUrl is the actual checkout URL (already URL-decoded by URLSearchParams.get)
    const checkout = new URL(urBackUrl);
    checkout.searchParams.delete("skip_shop_pay");
    return checkout.toString();
  } catch {
    return cartUrl;
  }
}

function isTrustedReferrerHost(referrerHost: string, requestHost: string) {
  const refHost = referrerHost.toLowerCase();
  const reqHost = requestHost.toLowerCase();
  if (refHost === reqHost) return true;
  if (TRUSTED_REFERRER_HOSTS.has(refHost)) return true;
  return refHost.endsWith(".usagummies.com");
}

function collectAttributionParams(req: NextRequest) {
  const out = new URLSearchParams();
  for (const key of ATTRIBUTION_KEYS) {
    const value = req.nextUrl.searchParams.get(key);
    if (value) out.set(key, value.slice(0, 180));
  }

  const referrer = req.headers.get("referer");
  if (!referrer) return out;

  try {
    const refUrl = new URL(referrer);
    if (!isTrustedReferrerHost(refUrl.host, req.nextUrl.host)) return out;
    for (const key of ATTRIBUTION_KEYS) {
      if (out.has(key)) continue;
      const value = refUrl.searchParams.get(key);
      if (value) out.set(key, value.slice(0, 180));
    }
  } catch {
    // Ignore malformed referrers.
  }

  return out;
}

function withAttribution(url: string, attribution: URLSearchParams) {
  if (![...attribution.keys()].length) return url;
  try {
    const parsed = new URL(url);
    for (const key of ATTRIBUTION_KEYS) {
      const value = attribution.get(key);
      if (!value || parsed.searchParams.has(key)) continue;
      parsed.searchParams.set(key, value);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Extract GA4 session_id from the container-specific _ga_* cookie */
function extractGA4SessionId(req: NextRequest): string {
  for (const cookie of req.cookies.getAll()) {
    if (!cookie.name.startsWith("_ga_")) continue;
    // Format: GS1.1.{session_id}.{session_count}.{engagement}.{timestamp}…
    const parts = cookie.value.split(".");
    if (parts.length >= 3 && /^\d{10}$/.test(parts[2])) return parts[2];
  }
  return "";
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

  // Stitch server event to the browser session
  const sessionId = extractGA4SessionId(req);
  if (sessionId) params.session_id = sessionId;
  // GA4 MP requires engagement_time_msec for events to be processed
  if (!params.engagement_time_msec) params.engagement_time_msec = 1;

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
  const attribution = collectAttributionParams(req);
  const referrer = req.headers.get("referer") || "";
  const ga4Params: Record<string, string | number> = {
    qty,
    page_path: "/go/checkout",
    page_location: `${req.nextUrl.origin}/go/checkout`,
    page_referrer: referrer,
  };
  for (const key of GA4_ATTRIBUTION_KEYS) {
    const value = attribution.get(key);
    if (!value) continue;
    ga4Params[key] = value;
  }

  // Server-side tracking — 100% accurate, no ad blocker can stop this
  fireGA4Event("go_checkout_redirect", ga4Params, req);
  console.info("go_checkout_redirect", ga4Params);

  if (!STOREFRONT_TOKEN) {
    return NextResponse.redirect(fallbackPermalink(qty, attribution), 302);
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
      return NextResponse.redirect(fallbackPermalink(qty, attribution), 302);
    }

    const json = await res.json();
    const cartUrl = json?.data?.cartCreate?.cart?.checkoutUrl;

    if (!cartUrl) {
      return NextResponse.redirect(fallbackPermalink(qty, attribution), 302);
    }

    // Resolve the cart URL into a direct checkout URL with skip_shop_pay
    // stripped — so the Shop Pay express button shows up at checkout. Falls
    // back gracefully to the cart URL if resolution fails.
    const shopPayFriendlyUrl = await resolveShopPayFriendlyCheckoutUrl(cartUrl);

    return NextResponse.redirect(
      withAttribution(shopPayFriendlyUrl, attribution),
      302,
    );
  } catch {
    return NextResponse.redirect(fallbackPermalink(qty, attribution), 302);
  }
}
