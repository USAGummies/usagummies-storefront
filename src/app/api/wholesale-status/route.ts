/**
 * Wholesale Order Status Lookup — /api/wholesale-status
 *
 * Public, no-auth customer-facing endpoint. Given an email, returns all
 * open B2B Wholesale deals for that contact along with the state of both
 * gates (payment + onboarding) so the customer can see exactly where
 * their order is in the pipeline.
 *
 * Intentionally lives OUTSIDE /api/ops/* to bypass the ops-session middleware.
 * Rate-limited via Vercel Edge middleware if abuse becomes an issue.
 */

import { NextResponse } from "next/server";
import { HUBSPOT, isHubSpotConfigured } from "@/lib/ops/hubspot-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HUBSPOT_API = "https://api.hubapi.com";

function hsToken(): string | null {
  return process.env.HUBSPOT_PRIVATE_APP_TOKEN?.trim() || null;
}

async function hsRequest<T = Record<string, unknown>>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T | null> {
  const token = hsToken();
  if (!token) return null;
  try {
    const res = await fetch(`${HUBSPOT_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// Human-readable stage labels for the B2B Wholesale pipeline
const STAGE_LABELS: Record<string, string> = {
  "3017533129": "Lead",
  "3017718461": "Contacted",
  "3017718462": "Responded",
  "3017718463": "Sample Requested",
  "3017718464": "Sample Shipped",
  "3017718465": "Quote/PO Sent",
  "3502336729": "Vendor Setup",
  "3017718466": "PO Received",
  "3017718460": "Shipped",
  "3485080311": "Reorder",
  "3502336730": "Closed Won",
  "3502659283": "Closed Lost",
  "3502659284": "On Hold",
};

export async function GET(req: Request) {
  if (!isHubSpotConfigured()) {
    return NextResponse.json({ error: "HubSpot not configured" }, { status: 500 });
  }
  const url = new URL(req.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  // 1. Find the contact by email
  const contactSearch = await hsRequest<{ results: { id: string; properties?: Record<string, string> }[] }>(
    "POST",
    "/crm/v3/objects/contacts/search",
    {
      limit: 1,
      filterGroups: [
        {
          filters: [{ propertyName: "email", operator: "EQ", value: email }],
        },
      ],
      properties: ["email", "firstname", "lastname", "company"],
    },
  );
  const contact = contactSearch?.results?.[0];
  if (!contact) {
    return NextResponse.json({
      ok: true,
      email,
      deals: [],
      message: "No orders found for that email. Check the spelling or contact support.",
    });
  }

  // 2. Get associated deal IDs
  const assoc = await hsRequest<{ results?: { toObjectId: string }[] }>(
    "GET",
    `/crm/v4/objects/contacts/${contact.id}/associations/deals`,
  );
  const dealIds = (assoc?.results ?? []).map((r) => r.toObjectId);

  if (dealIds.length === 0) {
    return NextResponse.json({
      ok: true,
      email,
      deals: [],
      message: "We found your contact but no orders yet. If you just placed one, give it a minute.",
    });
  }

  // 3. Fetch each deal's full state. Filter to B2B Wholesale pipeline only.
  const deals: {
    id: string;
    name: string;
    amount: string;
    stage: string;
    stageLabel: string;
    closeDate: string;
    paymentMethod: string;
    onboardingComplete: boolean;
    paymentReceived: boolean;
    onboardingUrl: string;
  }[] = [];

  const site =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "https://www.usagummies.com";

  for (const dealId of dealIds) {
    const deal = await hsRequest<{
      id: string;
      properties?: Record<string, string>;
    }>(
      "GET",
      `/crm/v3/objects/deals/${dealId}?properties=dealname,amount,dealstage,pipeline,closedate,wholesale_payment_method,wholesale_onboarding_complete,wholesale_payment_received`,
    );
    if (!deal?.properties) continue;
    if (deal.properties.pipeline !== HUBSPOT.PIPELINE_B2B_WHOLESALE) continue;
    deals.push({
      id: deal.id,
      name: deal.properties.dealname ?? "",
      amount: deal.properties.amount ?? "0",
      stage: deal.properties.dealstage ?? "",
      stageLabel: STAGE_LABELS[deal.properties.dealstage ?? ""] ?? "Unknown",
      closeDate: deal.properties.closedate ?? "",
      paymentMethod: deal.properties.wholesale_payment_method ?? "invoice_me",
      onboardingComplete: deal.properties.wholesale_onboarding_complete === "true",
      paymentReceived: deal.properties.wholesale_payment_received === "true",
      onboardingUrl: `${site}/onboarding/${deal.id}`,
    });
  }

  // Sort: most recently created first (by deal ID as a proxy — HubSpot deal IDs
  // are numeric-ish and increase over time)
  deals.sort((a, b) => Number(b.id) - Number(a.id));

  return NextResponse.json({
    ok: true,
    email,
    contact: {
      firstname: contact.properties?.firstname ?? "",
      company: contact.properties?.company ?? "",
    },
    deals,
  });
}
