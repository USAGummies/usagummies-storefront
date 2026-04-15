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
import {
  isHubSpotConfigured,
  upsertContactByEmail,
  createDeal,
  logEmail,
  createNote,
  splitName,
  HUBSPOT,
} from "@/lib/ops/hubspot-client";

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
      payment_method, // "pay_now" | "invoice_me" (optional; default "invoice_me")
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
    const basePrice = tier === "pallet" ? 3.00 : 3.25;
    const paymentMethod: "pay_now" | "invoice_me" =
      payment_method === "pay_now" ? "pay_now" : "invoice_me";
    // Pay-Now customers get a 5% prepay discount on the standard tier.
    // Pallet tier already reflects volume pricing; no extra prepay discount.
    // Rounded to 2 decimals so displayed per-bag × quantity == displayed total.
    const prepayMultiplier =
      paymentMethod === "pay_now" && tier === "standard" ? 0.95 : 1;
    const pricePerBag = Math.round(basePrice * prepayMultiplier * 100) / 100;
    const subtotal = Number((totalBags * pricePerBag).toFixed(2));
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

    // ── Shopify Draft Order (Pay Now only) ──
    // For Pay Now orders, create a Shopify Draft Order with a custom line item
    // at the prepay-discounted price and capture the hosted checkout URL so the
    // client can redirect the customer to Shop Pay / CC / ACH right after submit.
    let shopifyDraftOrderId: string | null = null;
    let shopifyInvoiceUrl: string | null = null;
    const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN?.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const shopifyToken = process.env.SHOPIFY_ADMIN_TOKEN;
    if (paymentMethod === "pay_now" && shopifyDomain && shopifyToken) {
      try {
        const pricePerMC = Number((totalBags * pricePerBag / qty).toFixed(2));
        const CREATE_DRAFT = `
          mutation draftOrderCreate($input: DraftOrderInput!) {
            draftOrderCreate(input: $input) {
              draftOrder { id name invoiceUrl totalPriceSet { shopMoney { amount currencyCode } } }
              userErrors { field message }
            }
          }
        `;
        const firstName = contact_name.split(/\s+/)[0] || contact_name;
        const lastName = contact_name.split(/\s+/).slice(1).join(" ") || "";
        const draftInput: Record<string, unknown> = {
          email: email.trim(),
          note: `Booth order (Pay Now). ${qty} MC × ${totalBags / qty} bags @ $${pricePerBag.toFixed(2)}/bag (5% prepay on standard tier). QBO customer: ${qboCustomerId || "pending"}.`,
          tags: ["wholesale", "booth", "pay_now", isShowDeal ? "show_special" : "standard"],
          lineItems: [
            {
              title: `USA Gummies — All American Gummy Bears Master Carton (${totalBags / qty} bags)`,
              originalUnitPriceWithCurrency: { amount: pricePerMC.toFixed(2), currencyCode: "USD" },
              quantity: qty,
              requiresShipping: true,
              taxable: true,
            },
          ],
          // Free shipping on standard tier / show deal; freight collect otherwise
          shippingLine:
            tier === "standard" || isShowDeal
              ? { title: "FREE SHIPPING (Show Special)", price: "0.00" }
              : { title: "Freight — invoiced separately", price: "0.00" },
        };
        if (ship_address) {
          draftInput.shippingAddress = {
            firstName,
            lastName,
            company: company_name.trim(),
            address1: ship_address.trim(),
            city: ship_city?.trim() || "",
            province: ship_state?.trim() || "",
            zip: ship_zip?.trim() || "",
            country: "United States",
            phone: phone?.trim() || "",
          };
        }

        const endpoint = `https://${shopifyDomain}/admin/api/2025-01/graphql.json`;
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": shopifyToken,
          },
          body: JSON.stringify({ query: CREATE_DRAFT, variables: { input: draftInput } }),
        });
        const json = await res.json() as {
          data?: {
            draftOrderCreate?: {
              draftOrder?: { id: string; name: string; invoiceUrl: string };
              userErrors?: { field: string[]; message: string }[];
            };
          };
        };
        const errs = json.data?.draftOrderCreate?.userErrors ?? [];
        if (errs.length) {
          console.error("[booth-order] Shopify draft order userErrors:", errs);
        } else {
          shopifyDraftOrderId = json.data?.draftOrderCreate?.draftOrder?.id ?? null;
          shopifyInvoiceUrl = json.data?.draftOrderCreate?.draftOrder?.invoiceUrl ?? null;
        }
      } catch (err) {
        console.error("[booth-order] Shopify draft order failed:", err instanceof Error ? err.message : err);
        // Fall through — customer still gets a confirmation and HubSpot deal.
        // We'll surface the failure in the response so the UI can show an error
        // and the customer can choose Invoice Me as a fallback.
      }
    }

    // ── HubSpot: upsert contact + create B2B Wholesale deal at PO Received ──
    // Mirror of the Bryce gold-standard workflow: every booth submit lands in
    // HubSpot with a deal gated on payment + onboarding. Ben is the owner.
    let hubspotContactId: string | null = null;
    let hubspotDealId: string | null = null;
    if (isHubSpotConfigured()) {
      try {
        const { firstname, lastname } = splitName(contact_name);
        const contact = await upsertContactByEmail({
          email: email.trim(),
          firstname,
          lastname,
          company: company_name.trim(),
          phone: phone?.trim(),
          address: ship_address?.trim(),
          city: ship_city?.trim(),
          state: ship_state?.trim(),
          zip: ship_zip?.trim(),
          lifecyclestage: "opportunity",
          hs_lead_status: "IN_PROGRESS",
        });
        if (contact) {
          hubspotContactId = contact.id;
          // Close date: 14 days out for Invoice Me, 7 days for Pay Now (faster path).
          const closeDays = paymentMethod === "pay_now" ? 7 : 14;
          const closeDate = new Date(Date.now() + closeDays * 86400000)
            .toISOString().slice(0, 10);
          const dealName = `Wholesale — ${company_name.trim()} (${
            isShowDeal ? "The Reunion 2026" : "Booth Order"
          })`;
          hubspotDealId = await createDeal({
            dealname: dealName,
            amount: subtotal,
            dealstage: HUBSPOT.STAGE_PO_RECEIVED,
            closedate: closeDate,
            contactId: contact.id,
            payment_method: paymentMethod,
            onboarding_complete: false,
            payment_received: false,
            description: [
              `Booth order via usagummies.com/booth, submitted ${orderDate} PT`,
              `${qty} Master Case${qty > 1 ? "s" : ""} (${totalBags} bags) × $${pricePerBag.toFixed(2)}`,
              `Subtotal: $${subtotal.toFixed(2)}`,
              `Payment method: ${paymentMethod === "pay_now" ? "Pay Now by card (5% prepay discount applied)" : "Invoice Me / Net 10"}`,
              `Pricing tier: ${tier === "pallet" ? "Pallet" : "Standard"}${isShowDeal ? " + Show Special (free shipping)" : ""}`,
              qboCustomerId ? `QBO Customer ID: ${qboCustomerId}` : "⚠ QBO customer not created",
              "",
              "Ship gate: onboarding_complete=false + payment_received=false. No ship until both flip true.",
            ].filter(Boolean).join("\n"),
          });
          if (hubspotDealId) {
            await createNote({
              body: [
                "<p><b>Booth order submitted</b></p>",
                `<p>Quantity: <b>${qty} MC (${totalBags} bags)</b><br/>`,
                `Price: <b>$${pricePerBag.toFixed(2)}/bag</b> × ${totalBags} = <b>$${subtotal.toFixed(2)}</b><br/>`,
                `Payment: <b>${paymentMethod === "pay_now" ? "Pay Now by card" : "Invoice Me / Net 10"}</b><br/>`,
                `Ship to: ${ship_address || "—"}${ship_city ? `, ${ship_city}` : ""}${ship_state ? ` ${ship_state}` : ""}${ship_zip ? ` ${ship_zip}` : ""}</p>`,
                qboCustomerId ? `<p>QBO Customer: <code>${qboCustomerId}</code></p>` : "",
                notes ? `<p>Customer notes: ${notes.replace(/[<>]/g, "")}</p>` : "",
              ].filter(Boolean).join(""),
              contactId: contact.id,
              dealId: hubspotDealId,
            });
          }
        }
      } catch (err) {
        console.error("[booth-order] HubSpot sync failed:", err instanceof Error ? err.message : err);
        // Continue — order already in QBO + Slack; HubSpot is non-blocking
      }
    }

    // ── Customer welcome email ──
    // Single link to the /onboarding/[dealId] portal. Inline web forms, no PDFs.
    // Portal shows the order summary + required info checklist + live ship status.
    let welcomeEmailSent = false;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "")
      || "https://www.usagummies.com";
    const onboardingUrl = hubspotDealId
      ? `${siteUrl}/onboarding/${hubspotDealId}`
      : `${siteUrl}/wholesale`;
    try {
      const firstName = contact_name.split(/\s+/)[0] || contact_name;
      const customerSubject = `USA Gummies — Order received (${company_name.trim()})`;
      const payNowSuffix = paymentMethod === "pay_now"
        ? " (5% prepay discount applied)" : "";
      const customerBody = [
        `Hi ${firstName},`,
        ``,
        `Thanks for your order${isShowDeal ? " from The Reunion" : ""}! We received it and we're on it.`,
        ``,
        `── Order summary ──`,
        `Product: All American Gummy Bears — 7.5 oz bag`,
        `Quantity: ${qty} Master Case${qty > 1 ? "s" : ""} (${totalBags} bags total)`,
        `Price: $${pricePerBag.toFixed(2)}/bag${payNowSuffix}`,
        `Subtotal: $${subtotal.toFixed(2)}`,
        `Shipping: ${tier === "standard" || isShowDeal ? "FREE" : "Buyer pays freight"}`,
        `Order total: $${subtotal.toFixed(2)}`,
        `Payment: ${paymentMethod === "pay_now" ? "Paid by card — thank you!" : "Invoice will arrive shortly (Net 10)"}`,
        ``,
        `── One quick step ──`,
        paymentMethod === "pay_now"
          ? `We just need 5 fast details (30 seconds) so we can get this on the truck. Click here to finish your setup:`
          : `We just need a quick customer info form so we can send your invoice and get this shipped. Click here to continue:`,
        ``,
        `${onboardingUrl}`,
        ``,
        paymentMethod === "pay_now"
          ? `We ship within 2 business days of receiving your info.`
          : `We'll email your invoice once you complete the form. Ship happens after payment clears.`,
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
        allowRepeat: true, // first-touch customer email, not throttled
      });
      welcomeEmailSent = result.ok;
      if (!result.ok) {
        console.error("[booth-order] welcome email failed:", result.message);
      }
    } catch (err) {
      console.error("[booth-order] welcome email threw:", err instanceof Error ? err.message : err);
    }

    // Log the welcome email engagement on the HubSpot contact + deal timeline
    if (welcomeEmailSent && hubspotContactId) {
      try {
        await logEmail({
          subject: `USA Gummies — Order received (${company_name.trim()})`,
          body: `Welcome email sent. Onboarding portal: ${onboardingUrl}. Payment method: ${paymentMethod}. Order total: $${subtotal.toFixed(2)}.`,
          to: email.trim(),
          contactId: hubspotContactId,
          dealId: hubspotDealId ?? undefined,
        });
      } catch {
        // non-fatal
      }
    }

    // Build Slack notification
    const methodTag = paymentMethod === "pay_now" ? "💳 PAY NOW" : "📄 INVOICE";
    const orderSummary = [
      `🎪 *NEW BOOTH ORDER — ${methodTag}*`,
      ``,
      `*Company:* ${company_name}`,
      `*Contact:* ${contact_name}`,
      `*Email:* ${email}`,
      phone ? `*Phone:* ${phone}` : null,
      ``,
      `*Order:* ${qty} Master Case${qty > 1 ? "s" : ""} (${totalBags} bags)`,
      `*Price:* $${pricePerBag.toFixed(2)}/bag${tier === "pallet" ? " (Pallet)" : paymentMethod === "pay_now" ? " (Pay Now, 5% prepay discount)" : " (Standard)"}`,
      `*Product Subtotal:* $${subtotal.toFixed(2)}`,
      isShowDeal ? `*🎪 SHOW DEAL — Freight absorbed*` : null,
      `*Order Total:* $${subtotal.toFixed(2)}${tier === "standard" || isShowDeal ? " (ship $0)" : ""}`,
      ``,
      ship_address ? `*Ship To:* ${ship_address}, ${ship_city || ""} ${ship_state || ""} ${ship_zip || ""}` : null,
      notes ? `*Notes:* ${notes}` : null,
      ``,
      qboCustomerId ? `*QBO Customer ID:* ${qboCustomerId}` : `⚠️ QBO customer not created — needs manual setup`,
      hubspotDealId ? `*HubSpot Deal:* ${hubspotDealId} (B2B Wholesale → PO Received)` : `⚠️ HubSpot deal not created`,
      paymentMethod === "pay_now"
        ? (shopifyInvoiceUrl
            ? `*💳 Shop Pay checkout:* <${shopifyInvoiceUrl}|${shopifyInvoiceUrl}>`
            : `⚠️ Pay Now requested but Shopify draft order FAILED — follow up manually`)
        : null,
      welcomeEmailSent ? `*✉️ Welcome email sent* → onboarding at <${onboardingUrl}|${onboardingUrl}>` : `⚠️ Welcome email NOT sent — follow up manually`,
      ``,
      `*Next steps:*`,
      paymentMethod === "pay_now"
        ? `1. Customer completes 5-field Quick Ship form at onboarding portal`
        : `1. Customer completes Full Setup form at onboarding portal`,
      `2. Onboarding gate flips green in HubSpot`,
      paymentMethod === "pay_now"
        ? `3. Payment already collected by card ✅`
        : `3. Viktor creates invoice using Trade Show item (ID 15, account 400015.15); customer pays invoice`,
      `4. Both gates green → Drew gets ship prep ping + pack sheet`,
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
      payment_method: paymentMethod,
      qbo_customer_id: qboCustomerId,
      hubspot_contact_id: hubspotContactId,
      hubspot_deal_id: hubspotDealId,
      welcome_email_sent: welcomeEmailSent,
      onboarding_url: onboardingUrl,
      // Pay Now path — Shopify Draft Order + checkout URL
      shopify_draft_order_id: shopifyDraftOrderId,
      payment_url: shopifyInvoiceUrl,
      message: shopifyInvoiceUrl
        ? "Order received. Redirecting you to secure checkout…"
        : "Order submitted successfully. Check your email for the onboarding link.",
    });
  } catch (error) {
    console.error("[booth-order] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Order submission failed" }, { status: 500 });
  }
}
