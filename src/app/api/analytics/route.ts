import { NextResponse, NextRequest } from "next/server";

/**
 * /api/analytics — first-party analytics beacon endpoint.
 *
 * Every trackEvent() call in the browser sends a beacon here via
 * navigator.sendBeacon (or fetch keepalive). This endpoint:
 *
 *   1. Stores the event in-memory (GET /api/analytics to view recent events)
 *   2. Forwards the event to GA4 via Measurement Protocol (server-side)
 *      — this survives ad blockers since the request comes from our domain
 *
 * GA4 Measurement Protocol requires:
 *   - GA4_API_SECRET env var (create in GA4 Admin → Data Streams → Measurement Protocol)
 *   - NEXT_PUBLIC_GA4_ID env var (or defaults to G-31X673PSVY)
 */

type AnalyticsEvent = {
  event: string;
  payload?: Record<string, unknown>;
  path?: string;
  ts?: number;
  cid?: string; // client ID passed from browser
};

type AnalyticsStore = {
  events: AnalyticsEvent[];
};

const MAX_EVENTS = 200;

const GA4_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA4_ID?.trim() || "G-31X673PSVY";
const GA4_API_SECRET = process.env.GA4_API_SECRET?.trim();

function getStore(): AnalyticsStore {
  const g = globalThis as unknown as { __usaAnalytics?: AnalyticsStore };
  if (!g.__usaAnalytics) {
    g.__usaAnalytics = { events: [] };
  }
  return g.__usaAnalytics;
}

function json(data: any, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Forward an event to GA4 via Measurement Protocol.
 * Fire-and-forget — we don't block the beacon response on this.
 */
async function forwardToGA4(
  event: string,
  payload: Record<string, unknown>,
  clientId: string,
) {
  if (!GA4_API_SECRET || !GA4_MEASUREMENT_ID) return;

  // GA4 MP params must be flat key-value (string/number).
  // Strip any nested objects and limit to GA4's 25-param max.
  const params: Record<string, string | number> = {};
  let count = 0;
  for (const [k, v] of Object.entries(payload)) {
    if (count >= 25) break;
    if (v === null || v === undefined) continue;
    if (typeof v === "string") {
      params[k] = v.slice(0, 100); // GA4 param value limit
      count++;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      params[k] = v;
      count++;
    }
    // skip objects/arrays/booleans — GA4 doesn't support them
  }

  try {
    await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          events: [{ name: event, params }],
        }),
      },
    );
  } catch {
    // Non-critical — don't let GA4 failures break the beacon
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.max(1, Math.min(200, Number(searchParams.get("limit") || 50)));
  const store = getStore();
  const events = store.events.slice(-limit).reverse();
  return json({ ok: true, count: store.events.length, events });
}

export async function POST(req: NextRequest) {
  let body: AnalyticsEvent;
  try {
    body = (await req.json()) as AnalyticsEvent;
  } catch {
    body = { event: "unknown" };
  }

  const event = String(body.event || "unknown");
  const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
  const path = typeof body.path === "string" ? body.path : undefined;
  const ts = Number(body.ts || Date.now());

  // Store in memory
  const store = getStore();
  store.events.push({ event, payload, path, ts });
  if (store.events.length > MAX_EVENTS) {
    store.events.splice(0, store.events.length - MAX_EVENTS);
  }

  // Build a client ID for GA4 MP.
  // Try to read the GA4 cookie (_ga=GA1.1.XXXXXXXX.YYYYYY) from the request,
  // or fall back to a hash of the IP + user-agent for anonymous tracking.
  let clientId = String(body.cid || "");
  if (!clientId) {
    const gaCookie = req.cookies.get("_ga")?.value;
    if (gaCookie) {
      // _ga cookie format: GA1.1.123456789.1234567890
      const parts = gaCookie.split(".");
      if (parts.length >= 4) {
        clientId = `${parts[2]}.${parts[3]}`;
      }
    }
  }
  if (!clientId) {
    // Fallback: deterministic ID from request headers
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const ua = req.headers.get("user-agent") || "unknown";
    // Simple hash — good enough for session deduplication
    let hash = 0;
    const str = `${ip}|${ua}`;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    clientId = `${Math.abs(hash)}.${Math.floor(ts / 1000)}`;
  }

  // Forward to GA4 (fire-and-forget, don't await)
  if (GA4_API_SECRET) {
    forwardToGA4(event, { ...payload, page_path: path }, clientId).catch(() => {});
  }

  console.info("Analytics event", { event, path, payload });
  return json({ ok: true });
}
