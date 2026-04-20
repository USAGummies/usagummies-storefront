/**
 * Booth Contact Capture API — /api/booth-order/capture
 *
 * POST — Capture required buyer + address info before revealing booth pricing.
 * Writes the contact into HubSpot when configured and falls back to a Slack
 * ops notification so anonymous pricing views do not bypass lead capture.
 */

import { NextResponse } from "next/server";
import {
  createNote,
  isHubSpotConfigured,
  upsertContactByEmail,
} from "@/lib/ops/hubspot-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const companyName = String(body.company_name ?? "").trim();
  const firstName = String(body.first_name ?? "").trim();
  const lastName = String(body.last_name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const phone = String(body.phone ?? "").trim();
  const shipAddress = String(body.ship_address ?? "").trim();
  const shipCity = String(body.ship_city ?? "").trim();
  const shipState = String(body.ship_state ?? "").trim().toUpperCase();
  const shipZip = String(body.ship_zip ?? "").trim();

  if (!companyName) {
    return NextResponse.json({ ok: false, error: "Company name is required" }, { status: 400 });
  }
  if (!firstName) {
    return NextResponse.json({ ok: false, error: "First name is required" }, { status: 400 });
  }
  if (!lastName) {
    return NextResponse.json({ ok: false, error: "Last name is required" }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json({ ok: false, error: "Email is required" }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json({ ok: false, error: "Phone is required" }, { status: 400 });
  }
  if (!shipAddress) {
    return NextResponse.json({ ok: false, error: "Shipping address is required" }, { status: 400 });
  }
  if (!shipCity) {
    return NextResponse.json({ ok: false, error: "Shipping city is required" }, { status: 400 });
  }
  if (!/^[A-Z]{2}$/.test(shipState)) {
    return NextResponse.json({ ok: false, error: "Enter a valid 2-letter state code" }, { status: 400 });
  }
  if (!/^\d{5}(-\d{4})?$/.test(shipZip)) {
    return NextResponse.json({ ok: false, error: "Enter a valid ZIP code" }, { status: 400 });
  }

  let captured = false;
  let hubspotContactId: string | null = null;
  let slackCaptured = false;

  if (isHubSpotConfigured()) {
    try {
      const contact = await upsertContactByEmail({
        email,
        firstname: firstName,
        lastname: lastName,
        company: companyName,
        phone,
        address: shipAddress,
        city: shipCity,
        state: shipState,
        zip: shipZip,
        lifecyclestage: "lead",
        hs_lead_status: "NEW",
        message: "Wholesale pricing unlock capture from /booth",
      });
      if (contact?.id) {
        hubspotContactId = contact.id;
        captured = true;
        await createNote({
          contactId: contact.id,
          body: [
            "<p><b>Wholesale pricing unlocked from /booth</b></p>",
            `<p>${escapeHtml(companyName)} — ${escapeHtml(firstName)} ${escapeHtml(lastName)}<br/>`,
            `${escapeHtml(email)} · ${escapeHtml(phone)}<br/>`,
            `${escapeHtml(shipAddress)}, ${escapeHtml(shipCity)}, ${escapeHtml(shipState)} ${escapeHtml(shipZip)}</p>`,
          ].join(""),
        });
      }
    } catch (error) {
      console.error("[booth-order/capture] HubSpot capture failed:", error);
    }
  }

  const webhookUrl = process.env.SLACK_SUPPORT_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: [
            "📝 *WHOLESALE PRICING UNLOCK*",
            `*Company:* ${companyName}`,
            `*Contact:* ${firstName} ${lastName}`,
            `*Email:* ${email}`,
            `*Phone:* ${phone}`,
            `*Address:* ${shipAddress}, ${shipCity}, ${shipState} ${shipZip}`,
          ].join("\n"),
        }),
      });
      if (res.ok) {
        slackCaptured = true;
        captured = true;
      }
    } catch (error) {
      console.error("[booth-order/capture] Slack capture failed:", error);
    }
  }

  if (!captured) {
    return NextResponse.json(
      { ok: false, error: "Could not save your contact info right now. Please try again." },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    hubspot_contact_id: hubspotContactId,
    slack_captured: slackCaptured,
  });
}
