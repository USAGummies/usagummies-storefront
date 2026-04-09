// src/lib/analytics.ts

type EventPayload = Record<string, unknown>;
const UTM_STORAGE_KEY = "usa_utms";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
    gtag?: (...args: any[]) => void;
    __usaEvents?: Array<Record<string, unknown>>;
  }
}

function getUtmParams() {
  if (typeof window === "undefined") return {} as Record<string, string>;
  try {
    const url = new URL(window.location.href);
    const params: Record<string, string> = {};
    UTM_KEYS.forEach((key) => {
      const value = url.searchParams.get(key);
      if (value) params[key] = value;
    });
    if (Object.keys(params).length) {
      window.localStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(params));
      return params;
    }
    const stored = window.localStorage.getItem(UTM_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, string>;
      }
    }
  } catch {
    // ignore
  }
  return {} as Record<string, string>;
}

export function trackEvent(event: string, payload: EventPayload = {}) {
  if (typeof window === "undefined") return;
  const utmParams = getUtmParams();
  const payloadWithUtm = { ...utmParams, ...payload };
  const data = { event, ...payloadWithUtm };

  try {
    if (!Array.isArray(window.dataLayer)) window.dataLayer = [];
    window.dataLayer.push(data);
  } catch {
    // ignore
  }

  try {
    if (typeof window.gtag === "function") {
      window.gtag("event", event, payloadWithUtm);
    }
  } catch {
    // ignore
  }

  try {
    if (!Array.isArray(window.__usaEvents)) window.__usaEvents = [];
    window.__usaEvents.push({ event, payload: payloadWithUtm, ts: Date.now() });
  } catch {
    // ignore
  }

  try {
    const body = JSON.stringify({
      event,
      payload: payloadWithUtm,
      path: window.location?.pathname || "",
      ts: Date.now(),
    });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/analytics", blob);
    } else {
      fetch("/api/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // ignore
  }
}

/* ── Meta Pixel helpers ── */
declare global {
  interface Window {
    fbq?: (...args: any[]) => void;
  }
}

function fbq(...args: any[]) {
  if (typeof window !== "undefined" && typeof window.fbq === "function") {
    window.fbq(...args);
  }
}

export function trackViewContent(item: { id: string; name: string; price: number; currency?: string }) {
  const currency = item.currency || "USD";

  // Meta Pixel: ViewContent
  fbq("track", "ViewContent", {
    content_ids: [item.id],
    content_name: item.name,
    content_type: "product",
    value: item.price,
    currency,
  });

  // GA4: view_item
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    window.gtag("event", "view_item", {
      currency,
      value: item.price,
      items: [{ item_id: item.id, item_name: item.name, price: item.price, quantity: 1 }],
    });
  }
}

export function trackAddToCart(item: { id: string; name: string; price: number; quantity: number; currency?: string }) {
  const currency = item.currency || "USD";
  const value = item.price * item.quantity;

  // Meta Pixel: AddToCart
  fbq("track", "AddToCart", {
    content_ids: [item.id],
    content_name: item.name,
    content_type: "product",
    value,
    currency,
    num_items: item.quantity,
  });

  // GA4: add_to_cart
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    window.gtag("event", "add_to_cart", {
      currency,
      value,
      items: [{ item_id: item.id, item_name: item.name, price: item.price, quantity: item.quantity }],
    });
  }
}

export function trackPurchase(order: { id: string; value: number; currency?: string; items?: Array<{ id: string; name: string; price: number; quantity: number }> }) {
  const currency = order.currency || "USD";

  // Meta Pixel: Purchase
  fbq("track", "Purchase", {
    value: order.value,
    currency,
    content_ids: order.items?.map((i) => i.id) || [],
    content_type: "product",
    num_items: order.items?.reduce((sum, i) => sum + i.quantity, 0) || 1,
  });

  // GA4: purchase
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    window.gtag("event", "purchase", {
      transaction_id: order.id,
      value: order.value,
      currency,
      items: order.items?.map((i) => ({ item_id: i.id, item_name: i.name, price: i.price, quantity: i.quantity })) || [],
    });
  }
}

export function applyExperimentFromUrl(param = "exp") {
  if (typeof window === "undefined") return null;
  let stored: string | null = null;
  try {
    const url = new URL(window.location.href);
    const exp = url.searchParams.get(param);
    if (exp) {
      window.localStorage.setItem("usa_exp", exp);
      stored = exp;
    } else {
      stored = window.localStorage.getItem("usa_exp");
    }
  } catch {
    stored = null;
  }

  try {
    if (stored) {
      document.body?.setAttribute("data-exp", stored);
    }
  } catch {
    // ignore
  }

  return stored;
}
