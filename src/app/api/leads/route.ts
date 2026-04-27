import { NextResponse } from "next/server";

import {
  isInquirySecretConfigured,
  signInquiryToken,
} from "@/lib/wholesale/inquiry-token";
import { appendWholesaleInquiry } from "@/lib/wholesale/inquiries";
import {
  createDeal,
  createNote,
  isHubSpotConfigured,
  splitName,
  upsertContactByEmail,
  HUBSPOT,
} from "@/lib/ops/hubspot-client";

type LeadPayload = {
  email?: string;
  phone?: string;
  source?: string;
  intent?: string;
  storeName?: string;
  buyerName?: string;
  location?: string;
  interest?: string;
};

function json(data: unknown, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Notion B2B pipeline insertion
// ---------------------------------------------------------------------------

const INTEREST_LABELS: Record<string, string> = {
  "starter-case": "Starter case (sample order)",
  "bulk-pricing": "Bulk wholesale pricing",
  "distribution": "Distribution partnership",
  "custom-private-label": "Custom / private label",
  "event-gifting": "Event or corporate gifting",
};

async function addToB2BPipeline(lead: {
  email: string;
  buyerName: string;
  storeName: string;
  location: string;
  interest: string;
  source: string;
}) {
  const notionKey = process.env.NOTION_API_KEY;
  // Distribution-related interests go to the distributor DB, rest go to B2B
  const isDistributor = lead.interest === "distribution";
  const dbId = isDistributor
    ? process.env.NOTION_DISTRIBUTOR_PROSPECTS_DB
    : process.env.NOTION_B2B_PROSPECTS_DB;

  if (!notionKey || !dbId) {
    console.warn("[leads] Notion B2B pipeline not configured, skipping.");
    return;
  }

  const interestLabel = INTEREST_LABELS[lead.interest] || lead.interest;
  const notesLines = [
    `Submitted via wholesale page`,
    lead.interest ? `Interest: ${interestLabel}` : "",
    lead.location ? `Location: ${lead.location}` : "",
    lead.buyerName ? `Contact: ${lead.buyerName}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Build Notion properties — field names vary between databases, so we
  // use the same patterns the pipeline route's parseLead() looks for.
  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: lead.storeName || lead.buyerName || lead.email } }] },
    Email: { email: lead.email },
    Status: { select: { name: "Lead" } },
    Source: { rich_text: [{ text: { content: lead.source || "wholesale-page" } }] },
    Notes: { rich_text: [{ text: { content: notesLines } }] },
  };

  // Add optional fields if the DB supports them
  if (lead.buyerName) {
    properties["Contact Name"] = {
      rich_text: [{ text: { content: lead.buyerName } }],
    };
  }
  if (lead.location) {
    properties["Location"] = {
      rich_text: [{ text: { content: lead.location } }],
    };
  }

  try {
    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionKey}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: dbId },
        properties,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error("[leads] Notion create failed:", res.status, err);
    } else {
      console.info("[leads] Added to B2B pipeline:", lead.email, isDistributor ? "(distributor)" : "(b2b)");
    }
  } catch (err) {
    console.error("[leads] Notion create error:", err);
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  let body: LeadPayload;
  try {
    body = (await req.json()) as LeadPayload;
  } catch {
    body = {};
  }

  const email = String(body.email || "").trim();
  const phone = String(body.phone || "").trim();
  const source = String(body.source || "unknown");
  const intent = String(body.intent || "newsletter");
  const storeName = String(body.storeName || "").trim();
  const buyerName = String(body.buyerName || "").trim();
  const location = String(body.location || "").trim();
  const interest = String(body.interest || "").trim();

  if (!email && !phone) {
    return json({ ok: false, error: "Missing email or phone." }, 400);
  }

  console.info("Lead capture", {
    email,
    phone,
    source,
    intent,
    storeName,
    buyerName,
    location,
    interest,
  });

  // Fire webhook (existing flow)
  const webhookUrl = process.env.LEADS_WEBHOOK_URL;
  if (webhookUrl) {
    const auth = process.env.LEADS_WEBHOOK_AUTH;
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: auth } : {}),
        },
        body: JSON.stringify({
          email,
          phone,
          source,
          intent,
          storeName,
          buyerName,
          location,
          interest,
          timestamp: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        console.warn("[leads] Webhook failed:", res.status);
      }
    } catch (err) {
      console.warn("[leads] Webhook error:", err);
    }
  }

  // Add wholesale leads to the Notion B2B pipeline
  if (intent === "wholesale" && email) {
    // Fire-and-forget — don't block the response on Notion write
    addToB2BPipeline({ email, buyerName, storeName, location, interest, source }).catch(() => {});
  }

  // Phase 6 — durable internal archive for wholesale inquiries.
  // Powers the auth-gated /api/ops/wholesale/inquiries list endpoint
  // and the Sales Command Center wholesale-inquiries source. Same
  // fail-soft pattern as the Notion mirror above: if KV is down or
  // unreachable, the public form submission still succeeds.
  if (intent === "wholesale" && (email || phone)) {
    appendWholesaleInquiry({
      email,
      phone,
      source,
      intent,
      storeName,
      buyerName,
      location,
      interest,
    }).catch((err) => {
      console.warn(
        "[leads] Wholesale inquiry archive write failed:",
        err instanceof Error ? err.message : err,
      );
    });
  }

  // Wholesale leads: create the HubSpot contact + deal directly in the
  // route. Replaces the previous Make.com-bridge dependency. Same
  // pattern as `/api/booth-order` — `upsertContactByEmail` + `createDeal`
  // with `payment_method: "invoice_me"` and `dealstage: STAGE_LEAD` so
  // the operator (Ben) can advance to "PO Received" once the wholesale
  // inquiry warms up. Fail-soft: HubSpot down / token missing logs +
  // continues — the public lead-capture submission stays a 200 either
  // way; the Notion mirror + KV archive are the durable backstops.
  let hubspotDealId: string | null = null;
  let hubspotContactId: string | null = null;
  if (intent === "wholesale" && email && isHubSpotConfigured()) {
    try {
      const { firstname, lastname } = splitName(buyerName);
      const contact = await upsertContactByEmail({
        email,
        firstname: firstname || undefined,
        lastname: lastname || undefined,
        company: storeName || undefined,
        phone: phone || undefined,
        // `location` from the public form is free-form (e.g. "Boise, ID"
        // or "Idaho"). Don't try to split — just send as `address` so it
        // surfaces somewhere; the operator dashboard reads it back.
        address: location || undefined,
        lifecyclestage: "lead",
        hs_lead_status: "OPEN",
        message: interest || undefined,
      });
      if (contact?.id) {
        hubspotContactId = contact.id;
        const dealName =
          storeName || buyerName || email
            ? `Wholesale inquiry — ${storeName || buyerName || email}`
            : "Wholesale inquiry";
        hubspotDealId = await createDeal({
          dealname: dealName,
          // Wholesale inquiries default to Invoice-Me; the customer
          // chooses Pay-Now via /booth, not /wholesale.
          payment_method: "invoice_me",
          dealstage: HUBSPOT.STAGE_LEAD,
          onboarding_complete: false,
          payment_received: false,
          description: interest || undefined,
          contactId: contact.id,
        });
        // Drop a structured note on the deal mirroring the inquiry
        // payload so operators see what the customer actually typed,
        // not just a stage flip. Best-effort; never blocks the response.
        if (hubspotDealId) {
          createNote({
            body: [
              `<p><b>Wholesale inquiry submitted via /wholesale</b></p>`,
              `<p>`,
              storeName ? `<b>Store:</b> ${escapeForNote(storeName)}<br/>` : "",
              buyerName ? `<b>Buyer:</b> ${escapeForNote(buyerName)}<br/>` : "",
              `<b>Email:</b> ${escapeForNote(email)}<br/>`,
              phone ? `<b>Phone:</b> ${escapeForNote(phone)}<br/>` : "",
              location ? `<b>Location:</b> ${escapeForNote(location)}<br/>` : "",
              source && source !== "unknown"
                ? `<b>Source:</b> ${escapeForNote(source)}<br/>`
                : "",
              `</p>`,
              interest
                ? `<p><b>Interest / notes:</b><br/>${escapeForNote(interest)}</p>`
                : "",
            ]
              .filter(Boolean)
              .join(""),
            timestamp: new Date().toISOString(),
            contactId: contact.id,
            dealId: hubspotDealId,
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.warn(
        "[leads] HubSpot deal-create failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Mint a sticky inquiry receipt URL for wholesale submissions when
  // the secret is configured. The URL is what the WholesaleForm
  // redirects to on success — the customer bookmarks it and returns
  // later to see status + upload requested docs.
  //
  // Fail-soft: if WHOLESALE_INQUIRY_SECRET is unset, omit `inquiryUrl`
  // from the response. The form's existing success state still works.
  let inquiryUrl: string | undefined;
  if (intent === "wholesale" && email && isInquirySecretConfigured()) {
    try {
      const token = signInquiryToken({ email, source });
      // Use NEXT_PUBLIC_SITE_URL for absolute URLs in emails / Slack;
      // fall back to a path-only string when not set (dev / preview).
      const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "";
      inquiryUrl = `${base}/wholesale/inquiry/${encodeURIComponent(token)}`;
    } catch {
      // Token mint failed (shouldn't happen since we just checked the
      // secret is set, but defensive). Don't break the lead capture.
    }
  }

  return json({
    ok: true,
    ...(inquiryUrl ? { inquiryUrl } : {}),
    ...(hubspotDealId ? { hubspotDealId } : {}),
    ...(hubspotContactId ? { hubspotContactId } : {}),
  });
}

/**
 * Minimal HTML escape for the HubSpot note body. Free-form customer
 * input flows through here, so we can't trust it.
 */
function escapeForNote(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
