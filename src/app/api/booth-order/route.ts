/**
 * Booth Order API — /api/ops/booth-order
 *
 * POST — Submit a new wholesale order from the trade show booth.
 * Creates QBO customer (if new), notifies Slack with deal details.
 * Does NOT create an invoice — Viktor handles that after Ben approves.
 *
 * Body (JSON):
 *   company_name, contact_name, email, phone,
 *   ship_address, ship_city, ship_state, ship_zip,
 *   quantity_cases, pricing_tier ("standard" | "pallet"),
 *   notes
 */

import { NextResponse } from "next/server";
import { createQBOCustomer } from "@/lib/ops/qbo-client";
import { isQBOConfigured } from "@/lib/ops/qbo-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      company_name,
      contact_name,
      email,
      phone,
      ship_address,
      ship_city,
      ship_state,
      ship_zip,
      quantity_cases,
      pricing_tier,
      show_deal,
      notes,
    } = body;

    // Validate required fields
    if (!company_name?.trim()) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }
    if (!contact_name?.trim()) {
      return NextResponse.json({ error: "Contact name is required" }, { status: 400 });
    }
    if (!email?.trim()) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const qty = Number(quantity_cases) || 1;
    const tier = pricing_tier === "pallet" ? "pallet" : "standard";
    const bagsPerCase = 36; // 6 cases × 6 bags
    const totalBags = qty * bagsPerCase;
    const pricePerBag = tier === "pallet" ? 3.00 : 3.25;
    const subtotal = totalBags * pricePerBag;
    const isShowDeal = show_deal === true;
    const freightNote = tier === "standard" || isShowDeal
      ? "FREE SHIPPING (included)"
      : "FREIGHT — buyer pays shipping";

    // Create QBO customer if QBO is connected
    let qboCustomerId: string | null = null;
    if (await isQBOConfigured()) {
      try {
        const result = await createQBOCustomer({
          DisplayName: company_name.trim(),
          CompanyName: company_name.trim(),
          ...(email ? { PrimaryEmailAddr: { Address: email.trim() } } : {}),
          ...(phone ? { PrimaryPhone: { FreeFormNumber: phone.trim() } } : {}),
          ...(ship_address ? {
            BillAddr: {
              Line1: ship_address.trim(),
              City: ship_city?.trim() || "",
              CountrySubDivisionCode: ship_state?.trim() || "",
              PostalCode: ship_zip?.trim() || "",
            },
            ShipAddr: {
              Line1: ship_address.trim(),
              City: ship_city?.trim() || "",
              CountrySubDivisionCode: ship_state?.trim() || "",
              PostalCode: ship_zip?.trim() || "",
            },
          } : {}),
        });
        const cust = (result as Record<string, unknown>)?.Customer || result;
        qboCustomerId = String((cust as Record<string, unknown>)?.Id || "");
      } catch (err) {
        console.error("[booth-order] QBO customer creation failed:", err);
        // Continue — order still gets logged to Slack
      }
    }

    // Build Slack notification
    const orderSummary = [
      `🎪 *NEW BOOTH ORDER — The Reunion*`,
      ``,
      `*Company:* ${company_name}`,
      `*Contact:* ${contact_name}`,
      `*Email:* ${email}`,
      phone ? `*Phone:* ${phone}` : null,
      ``,
      `*Order:* ${qty} Master Case${qty > 1 ? "s" : ""} (${totalBags} bags)`,
      `*Price:* $${pricePerBag.toFixed(2)}/bag${tier === "pallet" ? " (Pallet)" : " (Show Deal)"}`,
      `*Product Subtotal:* $${subtotal.toFixed(2)}`,
      `*Shipping:* Show on invoice at standard rate, then 100% show discount`,
      isShowDeal ? `*🎪 SHOW DEAL — Freight absorbed*` : null,
      `*Invoice Total:* $${subtotal.toFixed(2)} (shipping $0 after discount)`,
      ``,
      ship_address ? `*Ship To:* ${ship_address}, ${ship_city || ""} ${ship_state || ""} ${ship_zip || ""}` : null,
      notes ? `*Notes:* ${notes}` : null,
      ``,
      qboCustomerId ? `*QBO Customer ID:* ${qboCustomerId}` : `⚠️ QBO customer not created — needs manual setup`,
      ``,
      `*Next steps:*`,
      `1. Ben confirms pricing + approves`,
      `2. Viktor creates invoice (show shipping line → 100% discount)`,
      `3. Welcome packet + NCS-001 sent to customer`,
      `4. Payment received → ship order`,
    ].filter(Boolean).join("\n");

    // Post to Slack
    const webhookUrl = process.env.SLACK_SUPPORT_WEBHOOK_URL;
    if (webhookUrl) {
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: orderSummary }),
      }).catch(() => { /* best effort */ });
    }

    return NextResponse.json({
      ok: true,
      company: company_name,
      contact: contact_name,
      quantity_cases: qty,
      total_bags: totalBags,
      price_per_bag: pricePerBag,
      subtotal,
      pricing_tier: tier,
      show_deal: isShowDeal,
      freight: freightNote,
      qbo_customer_id: qboCustomerId,
      message: "Order submitted successfully. Our team will follow up shortly.",
    });
  } catch (error) {
    console.error("[booth-order] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Order submission failed" }, { status: 500 });
  }
}
