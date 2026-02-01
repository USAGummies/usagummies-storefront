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
