import { NextResponse } from "next/server";

type AnalyticsEvent = {
  event: string;
  payload?: Record<string, unknown>;
  path?: string;
  ts?: number;
};

type AnalyticsStore = {
  events: AnalyticsEvent[];
};

const MAX_EVENTS = 200;

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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.max(1, Math.min(200, Number(searchParams.get("limit") || 50)));
  const store = getStore();
  const events = store.events.slice(-limit).reverse();
  return json({ ok: true, count: store.events.length, events });
}

export async function POST(req: Request) {
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

  const store = getStore();
  store.events.push({ event, payload, path, ts });
  if (store.events.length > MAX_EVENTS) {
    store.events.splice(0, store.events.length - MAX_EVENTS);
  }

  console.info("Analytics event", { event, path, payload });
  return json({ ok: true });
}
