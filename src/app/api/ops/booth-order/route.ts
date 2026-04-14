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
import { sendOpsEmail } from "@/lib/ops/email";

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

    // Build order details string for QBO Notes field (so Viktor can see order info)
    const orderDate = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
    const qboNotes = [
      `=== BOOTH ORDER - The Reunion 2026 ===`,
      `Submitted: ${orderDate} PT`,
      ``,
      `QUANTITY: ${qty} Master Case${qty > 1 ? "s" : ""} (${totalBags} bags total)`,
      `PRICING: $${pricePerBag.toFixed(2)}/bag${tier === "pallet" ? " (Pallet tier)" : " (Show Deal)"}`,
      `SUBTOTAL: $${subtotal.toFixed(2)}`,
      `SHIPPING: ${tier === "standard" || isShowDeal ? "FREE (show on invoice at standard rate, then 100% discount)" : "Buyer pays freight"}`,
      isShowDeal ? `SHOW DEAL: YES - freight absorbed` : null,
      `INVOICE TOTAL: $${subtotal.toFixed(2)}`,
      ``,
      `Contact: ${contact_name}${phone ? ` | ${phone}` : ""}`,
      notes ? `Customer notes: ${notes}` : null,
    ].filter(Boolean).join("\n");

    // Create QBO customer if QBO is connected
    let qboCustomerId: string | null = null;
    if (await isQBOConfigured()) {
      try {
        const result = await createQBOCustomer({
          DisplayName: company_name.trim(),
          CompanyName: company_name.trim(),
          Notes: qboNotes,
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

    // ── Customer welcome email (the "trigger" into Rene+Viktor onboarding sequence) ──
    // Fires on submit. Tells the customer what's next and gives them the NCS-001 upload link.
    let welcomeEmailSent = false;
    try {
      const customerSubject = `USA Gummies — Order confirmation from The Reunion (${company_name.trim()})`;
      const customerBody = [
        `Hi ${contact_name.split(/\s+/)[0] || contact_name},`,
        ``,
        `Thanks for stopping by the USA Gummies booth at The Reunion! This email confirms we received your order request.`,
        ``,
        `── Order summary ──`,
        `Product: All American Gummy Bears — 7.5 oz bag`,
        `Quantity: ${qty} Master Case${qty > 1 ? "s" : ""} (${totalBags} bags total)`,
        `Price: $${pricePerBag.toFixed(2)}/bag${isShowDeal || tier === "standard" ? " (Show Special)" : " (Pallet)"}`,
        `Subtotal: $${subtotal.toFixed(2)}`,
        `Shipping: ${tier === "standard" || isShowDeal ? "FREE (100% show discount)" : "Buyer pays freight"}`,
        `Invoice total: $${subtotal.toFixed(2)}`,
        ``,
        `── What happens next ──`,
        `1. Ben confirms your pricing and approves the order.`,
        `2. You'll receive a formal invoice from our bookkeeper (Rene Gonzalez) with ACH payment details.`,
        `3. To speed up payment and shipping, please complete our short New Customer Setup form (NCS-001) and upload it here:`,
        `   https://www.usagummies.com/upload/ncs`,
        `4. Once payment is received, we'll ship as soon as Ben returns from the show (week of April 21).`,
        ``,
        `Questions? Reply to this email — it goes straight to Ben.`,
        ``,
        `Thanks again,`,
        `Ben Stutman`,
        `Founder, USA Gummies`,
        `ben@usagummies.com  |  (307) 209-4928`,
      ].join("\n");

      const result = await sendOpsEmail({
        to: email.trim(),
        subject: customerSubject,
        body: customerBody,
        allowRepeat: true,
      });
      welcomeEmailSent = result.ok;
      if (!result.ok) {
        console.error("[booth-order] welcome email failed:", result.message);
      }
    } catch (err) {
      console.error("[booth-order] welcome email threw:", err instanceof Error ? err.message : err);
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
      welcomeEmailSent ? `*✉️ Welcome email sent to ${email}* (with NCS-001 upload link)` : `⚠️ Welcome email NOT sent to ${email} — send manually`,
      ``,
      `*Next steps:*`,
      `1. Ben confirms pricing + approves`,
      `2. Viktor creates invoice using Trade Show item (ID 15, account 400015.15)`,
      `3. Customer uploads NCS-001 at usagummies.com/upload/ncs`,
      `4. Payment received → ship order when Ben returns from show`,
    ].filter(Boolean).join("\n");

    // Post to Slack (must await — serverless function exits before fire-and-forget completes)
    const webhookUrl = process.env.SLACK_SUPPORT_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: orderSummary }),
        });
      } catch {
        console.error("[booth-order] Slack webhook failed");
      }
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
      welcome_email_sent: welcomeEmailSent,
      message: "Order submitted successfully. Check your email for a confirmation and the customer setup link.",
    });
  } catch (error) {
    console.error("[booth-order] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Order submission failed" }, { status: 500 });
  }
}
