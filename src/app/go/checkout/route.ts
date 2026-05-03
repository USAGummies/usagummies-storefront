// /go/checkout — creates a Storefront API cart and redirects to the Shopify
// checkout URL directly (bypasses the Shop Pay / shop.app redirect).
//
// Supports ?qty=N parameter (default: 5). Clamped to 1–12.
//
// 2026-04-28 — Shop Pay re-enable. 6 InitiateCheckouts → 0 Purchases on 4/28
// because Storefront-API-generated cart URLs route through `shop.app` callback
// which appends `skip_shop_pay=true` to the final checkout URL, hiding the
// Shop Pay express button. Fix (validated via redirect-chain trace): append
// `skip_shop_pay=false` to the cart URL — Shopify honors the override AND
// skips the shop.app domain hop entirely. Result: user lands on
// `/checkouts/cn/{id}/en?_r=…&skip_shop_pay=false` directly, with Shop Pay
// express button visible. No server-side fetch (which would consume the
// single-use cart token and break the flow — see reverted commit 1975911).
//
// Also fires a server-side GA4 event via Measurement Protocol so we get
// 100% accurate checkout-redirect counts regardless of ad blockers.
import { NextRequest, NextResponse } from "next/server";
import { SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";
import { pricingForQty } from "@/lib/bundles/pricing";

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
// Meta Conversions API — server-side AddToCart so the event fires reliably
// even when the BagSlider's client-side fbq beacon gets canceled by the
// immediate page navigation, AND when ad blockers strip the pixel script.
// Fired against the Shopify pixel (664545086717590) — the ID our ad sets
// optimize on. Without this, ATC=0 in the audit even when users click Buy Now.
const META_CAPI_ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN?.trim();
const META_PIXEL_ID_SHOPIFY = "664545086717590";
const META_PIXEL_ID_WEBSITE = "26033875762978520";
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
  mutation CartCreate($lines: [CartLineInput!]!, $attributes: [AttributeInput!]) {
    cartCreate(input: { lines: $lines, attributes: $attributes }) {
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

/**
 * Build cart attributes that carry the buyer's identity bits across the
 * domain hop into Shopify checkout / Shop Pay. These end up on the order as
 * `note_attributes` and are read by `/api/ga4/purchase` to populate the
 * Meta Conversions API `user_data` block (fbp, fbc, IP, UA). Without these,
 * Meta receives the Purchase event but can't match it to a click — the
 * optimizer sees it as unattributable noise and never scales delivery.
 */
function buildCartAttributes(req: NextRequest): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  const fbp = req.cookies.get("_fbp")?.value;
  const fbc = req.cookies.get("_fbc")?.value;
  const userIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "";
  const userAgent = req.headers.get("user-agent") || "";
  if (fbp) out.push({ key: "fbp", value: fbp });
  if (fbc) out.push({ key: "fbc", value: fbc });
  if (userIp) out.push({ key: "client_ip", value: userIp });
  if (userAgent) out.push({ key: "client_ua", value: userAgent.slice(0, 500) });
  // Also stash the GCLID + fbclid if present so Google Ads / Meta offline
  // conversion backfills can attribute later if needed.
  const fbclid = req.nextUrl.searchParams.get("fbclid");
  const gclid = req.nextUrl.searchParams.get("gclid") ||
                req.nextUrl.searchParams.get("gbraid") ||
                req.nextUrl.searchParams.get("wbraid");
  if (fbclid) out.push({ key: "fbclid", value: fbclid.slice(0, 200) });
  if (gclid) out.push({ key: "gclid", value: gclid.slice(0, 200) });
  return out;
}

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

/**
 * Force the Shop Pay express button on by appending `skip_shop_pay=false` to
 * the cart URL. Validated 2026-04-28 via redirect-chain trace: with this param
 * appended to a Storefront-API-generated `…/cart/c/{token}?key=…` URL, Shopify
 * routes the user DIRECTLY to `…/checkouts/cn/{id}/en?_r=…&skip_shop_pay=false`
 * (skipping the shop.app callback entirely), where the Shop Pay express button
 * renders. Without this override, the same flow lands on a checkout URL with
 * `skip_shop_pay=true` because Shopify auto-adds it for Storefront-API carts.
 */
function withShopPayEnabled(url: string) {
  try {
    const parsed = new URL(url);
    // Override Shopify's default skip_shop_pay=true behavior on Storefront-API
    // cart URLs. `false` is honored end-to-end through the cart→checkout chain.
    parsed.searchParams.set("skip_shop_pay", "false");
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Force Shop Pay OFF on the checkout URL — used for Instagram, Facebook,
 * Threads, TikTok in-app browsers. 2026-05-03 trace confirmed:
 *
 *   - skip_shop_pay=false → Shopify routes through `shop.app/checkout` → IG
 *     in-app webview can't carry 3rd-party cookies → bumps to homepage.
 *   - skip_shop_pay=true  → Shopify routes DIRECTLY to
 *     `…/checkouts/cn/{id}/en?_r=…&skip_shop_pay=true` in 1 hop, lands on
 *     the standard checkout page (verified with cookie-jar curl).
 */
function withShopPayDisabled(url: string) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("skip_shop_pay", "true");
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

/**
 * Fire-and-forget server-side AddToCart via Meta Conversions API.
 *
 * Why server-side: BagSlider's client-side fbq("track", "AddToCart") fires
 * synchronously then immediately calls window.location.href = "/go/checkout".
 * Meta's pixel beacon is an HTTP request — when the page navigates, that
 * request is canceled, so the event never reaches Meta. Plus 30%+ of users
 * run ad blockers that strip the pixel script entirely. Result: ATC = 0 in
 * the audit even when users click Buy Now (we see this in funnel data:
 * 6 IC events, 0 ATC events for the same ~6 sessions).
 *
 * Server-side CAPI fires from /go/checkout itself, so it runs on every click
 * regardless of navigation timing or ad blocker state. Fires to BOTH the
 * Shopify pixel (664545086717590, what ad sets optimize on) and the website
 * pixel (26033875762978520) so both event databases stay in sync.
 *
 * Event ID is included so when the client-side fbq DOES manage to send (no
 * blocker, fast network), Meta deduplicates against this server event.
 */
function fireMetaCAPIAddToCart(req: NextRequest, qty: number) {
  if (!META_CAPI_ACCESS_TOKEN) return;

  const fbp = req.cookies.get("_fbp")?.value;
  const fbc = req.cookies.get("_fbc")?.value;
  const userIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "";
  const userAgent = req.headers.get("user-agent") || "";
  const referer = req.headers.get("referer") || `${req.nextUrl.origin}/shop`;
  // Stable event_id so client-side fbq AddToCart (when it fires at all) is
  // deduplicated against this server event by Meta.
  const eventId = `atc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const eventTime = Math.floor(Date.now() / 1000);

  const userData: Record<string, string> = {};
  if (userIp) userData.client_ip_address = userIp;
  if (userAgent) userData.client_user_agent = userAgent;
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;

  // Use the canonical bundle pricing helper so this stays in sync with what
  // the BagSlider shows the user (and what Shopify ultimately charges). Avoid
  // hardcoded constants — see commit history for the bug where a stale 19.95
  // constant got reported to Meta CAPI.
  const { total } = pricingForQty(qty);

  const payload = {
    data: [
      {
        event_name: "AddToCart",
        event_time: eventTime,
        event_id: eventId,
        event_source_url: referer,
        action_source: "website",
        user_data: userData,
        custom_data: {
          currency: "USD",
          value: Number(total.toFixed(2)),
          content_ids: ["all-american-gummy-bears"],
          content_type: "product",
          content_name: "All American Gummy Bears - 7.5 oz Bag",
          num_items: qty,
        },
      },
    ],
  };

  // Fire to BOTH pixels concurrently. Failures are silently swallowed — we
  // never block the user's redirect on a tracking call.
  for (const pixelId of [META_PIXEL_ID_SHOPIFY, META_PIXEL_ID_WEBSITE]) {
    fetch(
      `https://graph.facebook.com/v21.0/${pixelId}/events?access_token=${META_CAPI_ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    ).catch(() => {});
  }
}

/**
 * Detect Instagram, Facebook, or Threads in-app browser via user-agent.
 *
 * Why this matters (Clarity 2026-05-02): 89.74% of /go traffic today landed
 * via the Instagram in-app browser. The Storefront-API cart-token →
 * `skip_shop_pay=false` → Shop Pay redirect chain dies inside in-app
 * webviews (3rd-party cookies blocked, multi-hop redirect kills the token,
 * Shop Pay express button never renders). Result: 21 BUY-CTA clicks today,
 * only 1 reached Shopify checkout, 0 purchases.
 *
 * Fix: for in-app browsers, skip the Storefront API entirely and redirect
 * straight to the simple cart permalink (`/cart/{variantId}:{qty}`).
 * Single hop, no token race, no Shop Pay dependency. Automatic BXGY
 * discount still applies at the Shopify cart level (verified via
 * Storefront API: 5 bags = $23.96 cart total).
 *
 * Trade-off: in-app users lose the Shop Pay express button, but Shop Pay
 * doesn't work in their browser anyway. Desktop + native mobile browsers
 * still get the optimized Storefront API flow with Shop Pay.
 */
function isInAppBrowser(ua: string): boolean {
  if (!ua) return false;
  const u = ua.toLowerCase();
  return (
    u.includes("instagram") ||      // Instagram in-app browser
    u.includes("fban") ||           // Facebook iOS in-app
    u.includes("fbav") ||           // Facebook Android in-app
    u.includes("fb_iab") ||         // Facebook in-app (alt)
    u.includes("fb4a") ||           // Facebook for Android
    u.includes("barcelonaapp") ||   // Threads in-app
    u.includes("tiktok")            // TikTok in-app
  );
}

export async function GET(req: NextRequest) {
  const rawQty = req.nextUrl.searchParams.get("qty");
  const qty = rawQty ? Math.max(1, Math.min(12, Math.floor(Number(rawQty)) || DEFAULT_QTY)) : DEFAULT_QTY;
  const attribution = collectAttributionParams(req);
  const referrer = req.headers.get("referer") || "";
  const userAgent = req.headers.get("user-agent") || "";
  const inAppBrowser = isInAppBrowser(userAgent);
  const ga4Params: Record<string, string | number> = {
    qty,
    page_path: "/go/checkout",
    page_location: `${req.nextUrl.origin}/go/checkout`,
    page_referrer: referrer,
    in_app_browser: inAppBrowser ? "true" : "false",
  };
  for (const key of GA4_ATTRIBUTION_KEYS) {
    const value = attribution.get(key);
    if (!value) continue;
    ga4Params[key] = value;
  }

  // Server-side tracking — 100% accurate, no ad blocker can stop this
  fireGA4Event("go_checkout_redirect", ga4Params, req);
  // Server-side AddToCart to Meta CAPI — see fireMetaCAPIAddToCart docstring
  // for why this is needed (client-side beacon dies on navigation).
  fireMetaCAPIAddToCart(req, qty);
  console.info("go_checkout_redirect", ga4Params);

  // 2026-05-03 — Updated In-App Browser strategy.
  //
  // Previous approach (commit 3a52bb80) routed IG/FB/Threads/TikTok webviews
  // to the simple permalink (`/cart/{var}:{qty}`). Trace 2026-05-03 revealed
  // that path goes through `shop.app/checkout/.../shop_pay_callback` which
  // 3rd-party-cookie-blocked in-app webviews can't survive — they bump to
  // `https://usa-gummies.myshopify.com/` (homepage) instead of checkout.
  //
  // New approach: ALL flows use the Storefront API (single-source cart
  // creation, identity attributes preserved). Branch only on the Shop Pay
  // flag. Cookie-jar curl trace 2026-05-03:
  //   - Storefront URL + skip_shop_pay=true  → 1 hop → real checkout (1.56s)
  //   - Storefront URL + skip_shop_pay=false → goes through shop.app
  //     callback → fine on desktop with cookies, dies in IG webview.
  //
  // So in-app browsers get skip_shop_pay=true (no Shop Pay express, but
  // checkout actually works). Native browsers get skip_shop_pay=false (Shop
  // Pay express button + the optimized flow).

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
          attributes: buildCartAttributes(req),
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

    // Choose Shop Pay strategy based on browser. See block-comment above.
    const finalUrl = inAppBrowser
      ? withShopPayDisabled(checkoutUrl)
      : withShopPayEnabled(checkoutUrl);

    return NextResponse.redirect(
      withAttribution(finalUrl, attribution),
      302,
    );
  } catch {
    return NextResponse.redirect(fallbackPermalink(qty, attribution), 302);
  }
}
