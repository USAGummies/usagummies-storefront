import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_MIN_QTY,
  subscriptionPricingForQty,
} from "@/lib/bundles/pricing";

function json(data: unknown, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function kvKey(email: string) {
  return `sub:${email.toLowerCase().trim()}`;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

type Subscription = {
  email: string;
  name: string;
  quantity: number;
  frequency: string;
  frequencyDays: number;
  perBag: number;
  total: number;
  savings: number;
  status: "active" | "paused" | "cancelled";
  token: string;
  createdAt: string;
  nextDeliveryDate: string;
  pausedAt: string | null;
  cancelledAt: string | null;
};

// Auth: validate email + token combo
function authorize(sub: Subscription, token: string): boolean {
  return sub.token === token;
}

// ---------------------------------------------------------------------------
// GET — fetch subscription by email + token
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  const url = new URL(req.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  const token = url.searchParams.get("token") || "";

  if (!email) {
    return json({ ok: false, error: "Email is required." }, 400);
  }

  const sub = await kv.get<Subscription>(kvKey(email));
  if (!sub) {
    return json({ ok: false, error: "No subscription found for this email." }, 404);
  }

  if (!authorize(sub, token)) {
    return json({ ok: false, error: "Invalid token." }, 403);
  }

  // Omit token from response
  const safe = { ...sub };
  delete (safe as Partial<Subscription>).token;
  return json({ ok: true, subscription: safe });
}

// ---------------------------------------------------------------------------
// PATCH — update subscription (quantity, frequency, pause, resume, cancel)
// ---------------------------------------------------------------------------
export async function PATCH(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid request body." }, 400);
  }

  const email = String(body.email || "").trim().toLowerCase();
  const token = String(body.token || "");
  const action = String(body.action || "");

  if (!email) {
    return json({ ok: false, error: "Email is required." }, 400);
  }

  const sub = await kv.get<Subscription>(kvKey(email));
  if (!sub) {
    return json({ ok: false, error: "No subscription found." }, 404);
  }

  if (!authorize(sub, token)) {
    return json({ ok: false, error: "Invalid token." }, 403);
  }

  const now = new Date();

  switch (action) {
    case "update": {
      const newQty = body.quantity ? Number(body.quantity) : sub.quantity;
      const newFreq = body.frequency ? String(body.frequency) : sub.frequency;

      if (newQty < SUBSCRIPTION_MIN_QTY) {
        return json({ ok: false, error: `Minimum is ${SUBSCRIPTION_MIN_QTY} bags.` }, 400);
      }
      if (!SUBSCRIPTION_FREQUENCIES.some((f) => f.label === newFreq)) {
        return json({ ok: false, error: "Invalid frequency." }, 400);
      }

      const pricing = subscriptionPricingForQty(newQty);
      const freq = SUBSCRIPTION_FREQUENCIES.find((f) => f.label === newFreq)!;

      sub.quantity = newQty;
      sub.frequency = newFreq;
      sub.frequencyDays = freq.days;
      sub.perBag = pricing.perBag;
      sub.total = pricing.total;
      sub.savings = pricing.savings;

      // Recalculate next delivery from today
      sub.nextDeliveryDate = addDays(now, freq.days).toISOString();
      break;
    }

    case "pause": {
      if (sub.status !== "active") {
        return json({ ok: false, error: "Subscription is not active." }, 400);
      }
      sub.status = "paused";
      sub.pausedAt = now.toISOString();
      break;
    }

    case "resume": {
      if (sub.status !== "paused") {
        return json({ ok: false, error: "Subscription is not paused." }, 400);
      }
      sub.status = "active";
      sub.pausedAt = null;
      sub.nextDeliveryDate = addDays(now, sub.frequencyDays).toISOString();
      break;
    }

    case "cancel": {
      sub.status = "cancelled";
      sub.cancelledAt = now.toISOString();
      break;
    }

    default:
      return json({ ok: false, error: "Invalid action. Use: update, pause, resume, cancel." }, 400);
  }

  await kv.set(kvKey(email), sub);

  const safe = { ...sub };
  delete (safe as Partial<Subscription>).token;
  return json({ ok: true, subscription: safe });
}
