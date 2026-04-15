/**
 * Onboarding API — /api/ops/onboarding
 *
 * GET  ?dealId=XXX    — Fetch order summary + current onboarding state for a deal.
 *                       Public endpoint (no auth) so the customer-facing portal
 *                       at /onboarding/[dealId] can read the deal by ID.
 * POST                — Submit the condensed onboarding form.
 *                       Updates the HubSpot deal with customer info fields,
 *                       flips the onboarding gate, logs a note, and posts
 *                       a Slack notification.
 */

import { NextResponse } from "next/server";
import {
  isHubSpotConfigured,
  createNote,
  HUBSPOT,
} from "@/lib/ops/hubspot-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HUBSPOT_API = "https://api.hubapi.com";

function hsToken(): string | null {
  return process.env.HUBSPOT_PRIVATE_APP_TOKEN?.trim() || null;
}

async function hsGet<T = Record<string, unknown>>(path: string): Promise<T | null> {
  const token = hsToken();
  if (!token) return null;
  try {
    const res = await fetch(`${HUBSPOT_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function hsPatch<T = Record<string, unknown>>(
  path: string,
  body: unknown,
): Promise<T | null> {
  const token = hsToken();
  if (!token) return null;
  try {
    const res = await fetch(`${HUBSPOT_API}${path}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type DealProperties = {
  dealname?: string;
  amount?: string;
  dealstage?: string;
  closedate?: string;
  wholesale_payment_method?: string;
  wholesale_onboarding_complete?: string;
  wholesale_payment_received?: string;
  description?: string;
};

type HsDeal = {
  id: string;
  properties?: DealProperties;
};

type HsContactProps = {
  email?: string;
  firstname?: string;
  lastname?: string;
  company?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
};

type HsContact = {
  id: string;
  properties?: HsContactProps;
};

/**
 * GET — return the deal summary + associated contact + current onboarding state.
 * The customer-facing portal calls this with the dealId from the welcome email URL.
 */
export async function GET(req: Request) {
  if (!isHubSpotConfigured()) {
    return NextResponse.json({ error: "HubSpot not configured" }, { status: 500 });
  }
  const url = new URL(req.url);
  const dealId = url.searchParams.get("dealId");
  if (!dealId) {
    return NextResponse.json({ error: "dealId required" }, { status: 400 });
  }

  const deal = await hsGet<HsDeal>(
    `/crm/v3/objects/deals/${encodeURIComponent(dealId)}?properties=dealname,amount,dealstage,closedate,wholesale_payment_method,wholesale_onboarding_complete,wholesale_payment_received,description`,
  );
  if (!deal?.id) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // Fetch associated contact(s)
  const assoc = await hsGet<{ results?: { toObjectId: string }[] }>(
    `/crm/v4/objects/deals/${encodeURIComponent(dealId)}/associations/contacts`,
  );
  const contactId = assoc?.results?.[0]?.toObjectId;
  let contact: HsContact | null = null;
  if (contactId) {
    contact = await hsGet<HsContact>(
      `/crm/v3/objects/contacts/${contactId}?properties=email,firstname,lastname,company,phone,address,city,state,zip`,
    );
  }

  const p = deal.properties ?? {};
  const cp = contact?.properties ?? {};
  return NextResponse.json({
    ok: true,
    deal: {
      id: deal.id,
      name: p.dealname ?? "",
      amount: p.amount ?? "0",
      stage: p.dealstage ?? "",
      closeDate: p.closedate ?? "",
      paymentMethod: p.wholesale_payment_method ?? "invoice_me",
      onboardingComplete: p.wholesale_onboarding_complete === "true",
      paymentReceived: p.wholesale_payment_received === "true",
      description: p.description ?? "",
    },
    contact: contact
      ? {
          id: contact.id,
          email: cp.email ?? "",
          firstname: cp.firstname ?? "",
          lastname: cp.lastname ?? "",
          company: cp.company ?? "",
          phone: cp.phone ?? "",
          address: cp.address ?? "",
          city: cp.city ?? "",
          state: cp.state ?? "",
          zip: cp.zip ?? "",
        }
      : null,
  });
}

/**
 * POST — submit the onboarding form.
 *
 * Body (JSON):
 *   dealId                  — required
 *   legalBusinessName       — Tier 1
 *   ein                     — Tier 1 (EIN or last 4 of SSN)
 *   shipContactName         — Tier 1
 *   shipContactPhone        — Tier 1
 *   resaleCertNumber        — Tier 1 optional
 *   taxExemptState          — Tier 1 optional
 *   // Tier 2 (Invoice Me only):
 *   apContactName           — Tier 2
 *   apContactEmail          — Tier 2
 *   billingAddress          — Tier 2 optional (if different from shipping)
 *   preferredPayment        — Tier 2 ("ach" | "check" | "cc_via_invoice")
 *   tradeRef1Company        — Tier 2 OPTIONAL
 *   tradeRef1Phone          — Tier 2 OPTIONAL
 *   tradeRef2Company        — Tier 2 OPTIONAL
 *   tradeRef2Phone          — Tier 2 OPTIONAL
 *   termsAccepted           — Tier 2 required (checkbox)
 *   signerName              — Tier 2 required
 *   signerTitle             — Tier 2 required
 */
export async function POST(req: Request) {
  if (!isHubSpotConfigured()) {
    return NextResponse.json({ error: "HubSpot not configured" }, { status: 500 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const dealId = typeof b.dealId === "string" ? b.dealId : "";
  if (!dealId) {
    return NextResponse.json({ error: "dealId required" }, { status: 400 });
  }

  // Fetch the deal so we know Pay Now vs Invoice Me + whether we need Tier 2
  const deal = await hsGet<HsDeal>(
    `/crm/v3/objects/deals/${encodeURIComponent(dealId)}?properties=dealname,wholesale_payment_method,wholesale_onboarding_complete,wholesale_payment_received`,
  );
  if (!deal?.id) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const paymentMethod = deal.properties?.wholesale_payment_method ?? "invoice_me";
  const isInvoiceMe = paymentMethod === "invoice_me";

  // Tier 1 validation (always required)
  const legalBusinessName = typeof b.legalBusinessName === "string" ? b.legalBusinessName.trim() : "";
  const ein = typeof b.ein === "string" ? b.ein.trim() : "";
  const shipContactName = typeof b.shipContactName === "string" ? b.shipContactName.trim() : "";
  const shipContactPhone = typeof b.shipContactPhone === "string" ? b.shipContactPhone.trim() : "";
  const resaleCertNumber = typeof b.resaleCertNumber === "string" ? b.resaleCertNumber.trim() : "";
  const taxExemptState = typeof b.taxExemptState === "string" ? b.taxExemptState.trim() : "";

  const missing: string[] = [];
  if (!legalBusinessName) missing.push("legalBusinessName");
  if (!ein) missing.push("ein");
  if (!shipContactName) missing.push("shipContactName");
  if (!shipContactPhone) missing.push("shipContactPhone");

  // Tier 2 validation (Invoice Me only)
  let apContactName = "", apContactEmail = "", billingAddress = "";
  let preferredPayment = "", signerName = "", signerTitle = "";
  let termsAccepted = false;
  let tradeRef1Company = "", tradeRef1Phone = "", tradeRef2Company = "", tradeRef2Phone = "";
  if (isInvoiceMe) {
    apContactName = typeof b.apContactName === "string" ? b.apContactName.trim() : "";
    apContactEmail = typeof b.apContactEmail === "string" ? b.apContactEmail.trim() : "";
    billingAddress = typeof b.billingAddress === "string" ? b.billingAddress.trim() : "";
    preferredPayment = typeof b.preferredPayment === "string" ? b.preferredPayment.trim() : "";
    termsAccepted = b.termsAccepted === true;
    signerName = typeof b.signerName === "string" ? b.signerName.trim() : "";
    signerTitle = typeof b.signerTitle === "string" ? b.signerTitle.trim() : "";
    // Trade references — explicitly optional per Ben.
    tradeRef1Company = typeof b.tradeRef1Company === "string" ? b.tradeRef1Company.trim() : "";
    tradeRef1Phone = typeof b.tradeRef1Phone === "string" ? b.tradeRef1Phone.trim() : "";
    tradeRef2Company = typeof b.tradeRef2Company === "string" ? b.tradeRef2Company.trim() : "";
    tradeRef2Phone = typeof b.tradeRef2Phone === "string" ? b.tradeRef2Phone.trim() : "";

    if (!apContactName) missing.push("apContactName");
    if (!apContactEmail) missing.push("apContactEmail");
    if (!preferredPayment) missing.push("preferredPayment");
    if (!termsAccepted) missing.push("termsAccepted");
    if (!signerName) missing.push("signerName");
    if (!signerTitle) missing.push("signerTitle");
  }

  if (missing.length) {
    return NextResponse.json(
      { error: "Missing required fields", missing },
      { status: 400 },
    );
  }

  // Write the info to the HubSpot deal as custom properties + note.
  // We store the full onboarding payload as a structured note on the deal
  // rather than as 20 separate custom deal properties, because HubSpot
  // free-tier limits custom property count. The gate field is the only
  // one we flip directly on the deal.
  await hsPatch(`/crm/v3/objects/deals/${encodeURIComponent(dealId)}`, {
    properties: {
      wholesale_onboarding_complete: "true",
    },
  });

  const tierLabel = isInvoiceMe ? "Full Setup (Invoice Me)" : "Quick Ship (Pay Now)";
  const noteHtml = [
    `<p><b>✅ Customer onboarding submitted — ${tierLabel}</b></p>`,
    `<p><b>Tier 1 — Business info</b><br/>`,
    `Legal business name: <b>${escapeHtml(legalBusinessName)}</b><br/>`,
    `EIN / Tax ID: <code>${escapeHtml(ein)}</code><br/>`,
    `Ship contact: ${escapeHtml(shipContactName)} — ${escapeHtml(shipContactPhone)}<br/>`,
    resaleCertNumber ? `Resale cert #: ${escapeHtml(resaleCertNumber)}<br/>` : "",
    taxExemptState ? `Tax-exempt state: ${escapeHtml(taxExemptState)}<br/>` : "",
    `</p>`,
    isInvoiceMe ? `<p><b>Tier 2 — Credit + terms</b><br/>
      AP contact: ${escapeHtml(apContactName)} — ${escapeHtml(apContactEmail)}<br/>
      ${billingAddress ? `Billing address: ${escapeHtml(billingAddress)}<br/>` : ""}
      Preferred payment: <b>${escapeHtml(preferredPayment)}</b><br/>
      Terms accepted: <b>YES</b><br/>
      Authorized signer: ${escapeHtml(signerName)}, ${escapeHtml(signerTitle)}<br/>
      ${tradeRef1Company ? `Trade ref 1: ${escapeHtml(tradeRef1Company)} — ${escapeHtml(tradeRef1Phone)}<br/>` : ""}
      ${tradeRef2Company ? `Trade ref 2: ${escapeHtml(tradeRef2Company)} — ${escapeHtml(tradeRef2Phone)}<br/>` : ""}
      </p>` : "",
    `<p style="color:#2e7d32"><b>Onboarding gate: GREEN ✅</b> — clear to ship once payment gate also green.</p>`,
  ].filter(Boolean).join("");

  // Find the associated contact so we log the note on both records
  const assoc = await hsGet<{ results?: { toObjectId: string }[] }>(
    `/crm/v4/objects/deals/${encodeURIComponent(dealId)}/associations/contacts`,
  );
  const contactId = assoc?.results?.[0]?.toObjectId;

  await createNote({
    body: noteHtml,
    dealId,
    contactId,
  });

  // Slack notification
  const webhookUrl = process.env.SLACK_SUPPORT_WEBHOOK_URL;
  if (webhookUrl) {
    const dealName = deal.properties?.dealname ?? dealId;
    const slackMsg = [
      `✅ *CUSTOMER INFO RECEIVED — ${tierLabel}*`,
      `*Deal:* ${dealName}`,
      `*Legal name:* ${legalBusinessName}`,
      `*EIN/Tax ID:* ${ein}`,
      `*Ship contact:* ${shipContactName} — ${shipContactPhone}`,
      isInvoiceMe ? `*AP contact:* ${apContactName} — ${apContactEmail}` : null,
      isInvoiceMe ? `*Preferred payment:* ${preferredPayment}` : null,
      isInvoiceMe ? `*Authorized signer:* ${signerName}, ${signerTitle}` : null,
      ``,
      `*Onboarding gate:* GREEN ✅`,
      `HubSpot deal: ${dealId}`,
    ].filter(Boolean).join("\n");
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: slackMsg }),
      });
    } catch {
      // non-fatal
    }
  }

  // If the deal is Pay Now, the payment gate is already green (payment was
  // collected upfront via Shopify/Stripe), so onboarding submit means the
  // deal is now fully cleared to ship. Surface the "clear to pack" state.
  const payGateGreen = deal.properties?.wholesale_payment_received === "true"
    || paymentMethod === "pay_now";

  return NextResponse.json({
    ok: true,
    dealId,
    onboarding_gate: "green",
    payment_gate: payGateGreen ? "green" : "pending",
    clear_to_pack: payGateGreen,
    message: payGateGreen
      ? "All set! Your order is cleared to ship. You'll get tracking within 2 business days."
      : "All set! Your customer info is locked in. We'll ship as soon as payment clears.",
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Silence unused-import lint when HUBSPOT re-export isn't referenced here directly.
void HUBSPOT;
