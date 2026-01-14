// src/lib/analytics.ts

type EventPayload = Record<string, unknown>;

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
    gtag?: (...args: any[]) => void;
    __usaEvents?: Array<Record<string, unknown>>;
  }
}

export function trackEvent(event: string, payload: EventPayload = {}) {
  if (typeof window === "undefined") return;
  const data = { event, ...payload };

  try {
    if (!Array.isArray(window.dataLayer)) window.dataLayer = [];
    window.dataLayer.push(data);
  } catch {
    // ignore
  }

  try {
    if (typeof window.gtag === "function") {
      window.gtag("event", event, payload);
    }
  } catch {
    // ignore
  }

  try {
    if (!Array.isArray(window.__usaEvents)) window.__usaEvents = [];
    window.__usaEvents.push({ event, payload, ts: Date.now() });
  } catch {
    // ignore
  }

  try {
    const body = JSON.stringify({
      event,
      payload,
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
