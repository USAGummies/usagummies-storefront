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
    const checkoutUrl = json?.data?.cartCreate?.cart?.checkoutUrl;

    if (!checkoutUrl) {
      return NextResponse.redirect(fallbackPermalink(qty, attribution), 302);
    }

    return NextResponse.redirect(withAttribution(checkoutUrl, attribution), 302);
  } catch {
    return NextResponse.redirect(fallbackPermalink(qty, attribution), 302);
  }
}
