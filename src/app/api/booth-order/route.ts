/**
 * Booth Order API — /api/booth-order
 *
 * POST — Submit a new wholesale order from the trade show booth or the
 * /booth landing page. Re-quotes UPS Ground freight server-side so the
 * customer can't tamper with the displayed rate. Creates QBO customer (if
 * new), notifies Slack with deal details, drops a HubSpot deal at PO
 * Received, fires the customer welcome email, and (Pay Now only) creates a
 * Shopify Draft Order with the real freight as a shipping line.
 *
 * Body (JSON):
 *   company_name, contact_name, email, phone,
 *   ship_address, ship_city, ship_state, ship_zip,
 *   quantity_cases, pricing_tier ("standard" | "pallet"),
 *   payment_method ("pay_now" | "invoice_me"),
 *   notes
 */

import { NextResponse } from "next/server";
import { createQBOCustomer, createQBOInvoice } from "@/lib/ops/qbo-client";
import { isQBOConfigured } from "@/lib/ops/qbo-client";
import { getRealmId, getValidAccessToken } from "@/lib/ops/qbo-auth";
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
import {
  getUpsGroundRate,
  isShipStationConfigured,
} from "@/lib/ops/shipstation-client";
import { upsertOrder } from "@/lib/ops/order-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QBO_TRADE_SHOW_ITEM_ID = process.env.QBO_TRADE_SHOW_ITEM_ID?.trim() || "15";

type ShopifyDraftCreateResponse = {
  data?: {
    draftOrderCreate?: {
      draftOrder?: { id: string; name: string; invoiceUrl: string };
      userErrors?: { field?: string[]; message: string }[];
    };
  };
};

type ShopifyDraftCompleteResponse = {
  data?: {
    draftOrderComplete?: {
      draftOrder?: {
        id: string;
        order?: {
          id: string;
          name: string;
          displayFinancialStatus?: string | null;
          displayFulfillmentStatus?: string | null;
        } | null;
      };
      userErrors?: { field?: string[]; message: string }[];
    };
  };
};

async function sendQBOInvoiceEmail(invoiceId: string, customerEmail: string): Promise<boolean> {
  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId || !customerEmail.trim()) return false;

  const host = process.env.QBO_SANDBOX === "true"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";

  const url = `${host}/v3/company/${realmId}/invoice/${invoiceId}/send?sendTo=${encodeURIComponent(customerEmail.trim())}&minorversion=75`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/octet-stream",
        Accept: "application/json",
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

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
    const bagsPerCase = 36; // 6 inner cases × 6 bags
    const masterCasesPerPallet = 25;
    // Pallet tier sells in PALLETS (qty = pallets, 25 MCs / 900 bags each)
    // at $3/bag LANDED — freight is rolled into price. Standard sells in
    // master cases (qty = MCs, 36 bags) at $3.25/bag + UPS Ground on top.
    const masterCasesCount =
      tier === "pallet" ? qty * masterCasesPerPallet : qty;
    const totalBags = masterCasesCount * bagsPerCase;
    const basePrice = tier === "pallet" ? 3.00 : 3.25;
    const paymentMethod: "pay_now" | "invoice_me" =
      payment_method === "pay_now" ? "pay_now" : "invoice_me";
    // Pay-Now customers get a 5% prepay discount on the standard tier.
    // Pallet tier already reflects volume pricing; no extra prepay discount.
    const prepayMultiplier =
      paymentMethod === "pay_now" && tier === "standard" ? 0.95 : 1;
    const pricePerBag = Math.round(basePrice * prepayMultiplier * 100) / 100;
    const subtotal = Number((totalBags * pricePerBag).toFixed(2));

    // ── Server-side freight re-quote (standard tier only) ──
    // Pallet is LANDED pricing — freight is rolled into $3/bag. We absorb
    // the LTL cost. For standard MC orders we re-quote UPS Ground
    // server-side so customers can't fudge the displayed number. If
    // ShipStation is down we still accept the order and flag it for manual
    // quote.
    let freightAmount = 0;
    let freightLabel = tier === "pallet"
      ? "Included in price (LTL landed)"
      : "UPS Ground (quote pending)";
    let freightCarrier: string | null = null;
    let freightService: string | null = null;
    let freightDays: number | null = null;
    let freightError: string | null = null;
    if (tier === "standard" && ship_state?.trim() && ship_zip?.trim()) {
      if (isShipStationConfigured()) {
        const rateRes = await getUpsGroundRate({
          toState: String(ship_state).trim().toUpperCase(),
          toZip: String(ship_zip).trim(),
          qtyMasterCases: qty,
        });
        if (rateRes.ok) {
          freightAmount = rateRes.quote.rate;
          freightCarrier = rateRes.quote.carrier;
          freightService = rateRes.quote.service;
          freightDays = rateRes.quote.delivery_days;
          freightLabel = `${rateRes.quote.service} — $${freightAmount.toFixed(2)}${
            freightDays ? ` (~${freightDays} day${freightDays > 1 ? "s" : ""})` : ""
          }`;
        } else {
          freightError = rateRes.error;
          console.error("[booth-order] freight re-quote failed:", rateRes.error);
        }
      } else {
        freightError = "ShipStation not configured";
      }
    }
    const orderTotal = Number((subtotal + freightAmount).toFixed(2));

    // Build order details string for QBO Notes field (so Viktor can see order info)
    const orderDate = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
    const unitLabel = tier === "pallet" ? "Pallet" : "Master Case";
    const qboNotes = [
      `=== BOOTH ORDER ===`,
      `Submitted: ${orderDate} PT`,
      ``,
      `QUANTITY: ${qty} ${unitLabel}${qty > 1 ? "s" : ""} (${masterCasesCount} master case${masterCasesCount > 1 ? "s" : ""} · ${totalBags} bags total)`,
      `PRICING: $${pricePerBag.toFixed(2)}/bag${tier === "pallet" ? " (Pallet tier — landed)" : " (Standard)"}`,
      `SUBTOTAL: $${subtotal.toFixed(2)}`,
      `SHIPPING: ${freightLabel}`,
      freightError ? `⚠ FREIGHT QUOTE ERROR: ${freightError} — re-quote manually` : null,
      `INVOICE TOTAL: $${orderTotal.toFixed(2)}`,
      ``,
      `Contact: ${contact_name}${phone ? ` | ${phone}` : ""}`,
      notes ? `Customer notes: ${notes}` : null,
    ].filter(Boolean).join("\n");

    // Create QBO customer if QBO is connected
    let qboCustomerId: string | null = null;
    let qboInvoiceId: string | null = null;
    let qboInvoiceDocNumber: string | null = null;
    let qboInvoiceSent = false;
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
    // For Pay Now orders, create a Shopify Draft Order with a custom line
    // item at the prepay-discounted price, plus the real UPS Ground freight
    // as the shipping line, and capture the hosted checkout URL so the
    // client can redirect the customer to Shop Pay / CC / ACH right after
    // submit.
    let shopifyDraftOrderId: string | null = null;
    let shopifyInvoiceUrl: string | null = null;
    let shopifyOrderId: string | null = null;
    let shopifyOrderName: string | null = null;
    const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN?.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const shopifyToken = process.env.SHOPIFY_ADMIN_TOKEN;
    if (paymentMethod === "pay_now" && shopifyDomain && shopifyToken) {
      try {
        const bagsPerUnit = totalBags / qty; // 36 for standard MC, 900 for pallet
        const pricePerUnit = Number((bagsPerUnit * pricePerBag).toFixed(2));
        const lineItemTitle = tier === "pallet"
          ? `USA Gummies — All American Gummy Bears Pallet (${masterCasesPerPallet} master cases / ${bagsPerUnit} bags · landed)`
          : `USA Gummies — All American Gummy Bears Master Carton (${bagsPerUnit} bags)`;
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
        const shippingTitle =
          tier === "pallet"
            ? `Pallet (LTL) — included in landed price`
            : freightAmount > 0
              ? `UPS Ground (${qty} master case${qty > 1 ? "s" : ""} from Ashford, WA)`
              : "Shipping — quote pending, billed on invoice";
        const draftInput: Record<string, unknown> = {
          email: email.trim(),
          note: `Booth order (Pay Now). ${qty} ${unitLabel.toLowerCase()}${qty > 1 ? "s" : ""} (${masterCasesCount} MC · ${totalBags} bags) @ $${pricePerBag.toFixed(2)}/bag${tier === "pallet" ? " landed" : ""}. Freight: ${freightLabel}. QBO customer: ${qboCustomerId || "pending"}.`,
          tags: ["wholesale", "booth", "pay_now", tier],
          lineItems: [
            {
              title: lineItemTitle,
              originalUnitPriceWithCurrency: { amount: pricePerUnit.toFixed(2), currencyCode: "USD" },
              quantity: qty,
              requiresShipping: true,
              taxable: true,
            },
          ],
          shippingLine: {
            title: shippingTitle,
            price: freightAmount.toFixed(2),
          },
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
      }
    }

    // ── Shopify order (Invoice Me) ──
    // Invoice-based booth orders need to appear in a real operational queue.
    // We create a draft, then complete it as payment-pending so it shows up
    // in Shopify Orders while staying on ship hold until payment clears.
    if (paymentMethod === "invoice_me" && shopifyDomain && shopifyToken) {
      try {
        const lineItemTitle = tier === "pallet"
          ? `USA Gummies — All American Gummy Bears Pallet (${masterCasesPerPallet} master cases / ${totalBags} bags · landed)`
          : `USA Gummies — All American Gummy Bears Master Carton (${bagsPerCase} bags)`;
        const pricePerUnit = tier === "pallet"
          ? Number((masterCasesPerPallet * bagsPerCase * pricePerBag).toFixed(2))
          : Number((bagsPerCase * pricePerBag).toFixed(2));
        const firstName = contact_name.split(/\s+/)[0] || contact_name;
        const lastName = contact_name.split(/\s+/).slice(1).join(" ") || "";
        const shippingTitle =
          tier === "pallet"
            ? "Pallet (LTL) — included in landed price"
            : freightAmount > 0
              ? `UPS Ground (${qty} master case${qty > 1 ? "s" : ""} from Ashford, WA)`
              : "Shipping — quote pending, billed on invoice";

        const createDraftMutation = `
          mutation draftOrderCreate($input: DraftOrderInput!) {
            draftOrderCreate(input: $input) {
              draftOrder { id name invoiceUrl }
              userErrors { field message }
            }
          }
        `;

        const draftInput: Record<string, unknown> = {
          email: email.trim(),
          note: [
            `Booth order (Invoice Me / Net 10).`,
            `${qty} ${unitLabel.toLowerCase()}${qty > 1 ? "s" : ""} (${masterCasesCount} MC · ${totalBags} bags) @ $${pricePerBag.toFixed(2)}/bag${tier === "pallet" ? " landed" : ""}.`,
            `Freight: ${freightLabel}.`,
            "SHIP HOLD: do not fulfill until QBO invoice is paid.",
            qboCustomerId ? `QBO customer: ${qboCustomerId}.` : "QBO customer: pending.",
          ].join(" "),
          tags: ["wholesale", "booth", "invoice_me", tier, "awaiting_payment", "ship_hold"],
          lineItems: [
            {
              title: lineItemTitle,
              originalUnitPriceWithCurrency: {
                amount: pricePerUnit.toFixed(2),
                currencyCode: "USD",
              },
              quantity: qty,
              requiresShipping: true,
              taxable: true,
            },
          ],
          shippingLine: {
            title: shippingTitle,
            price: freightAmount.toFixed(2),
          },
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
        const createRes = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": shopifyToken,
          },
          body: JSON.stringify({ query: createDraftMutation, variables: { input: draftInput } }),
        });
        const createJson = await createRes.json() as ShopifyDraftCreateResponse;
        const createErrors = createJson.data?.draftOrderCreate?.userErrors ?? [];
        if (createErrors.length) {
          console.error("[booth-order] Shopify invoice draft userErrors:", createErrors);
        } else {
          shopifyDraftOrderId = createJson.data?.draftOrderCreate?.draftOrder?.id ?? null;
          shopifyInvoiceUrl = createJson.data?.draftOrderCreate?.draftOrder?.invoiceUrl ?? null;
        }

        if (shopifyDraftOrderId) {
          const completeDraftMutation = `
            mutation draftOrderComplete($id: ID!, $paymentPending: Boolean) {
              draftOrderComplete(id: $id, paymentPending: $paymentPending) {
                draftOrder {
                  id
                  order {
                    id
                    name
                    displayFinancialStatus
                    displayFulfillmentStatus
                  }
                }
                userErrors { field message }
              }
            }
          `;

          const completeRes = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": shopifyToken,
            },
            body: JSON.stringify({
              query: completeDraftMutation,
              variables: { id: shopifyDraftOrderId, paymentPending: true },
            }),
          });
          const completeJson = await completeRes.json() as ShopifyDraftCompleteResponse;
          const completeErrors = completeJson.data?.draftOrderComplete?.userErrors ?? [];
          if (completeErrors.length) {
            console.error("[booth-order] Shopify invoice draft completion userErrors:", completeErrors);
          } else {
            shopifyOrderId = completeJson.data?.draftOrderComplete?.draftOrder?.order?.id ?? null;
            shopifyOrderName = completeJson.data?.draftOrderComplete?.draftOrder?.order?.name ?? null;
          }
        }
      } catch (err) {
        console.error("[booth-order] Shopify invoice order failed:", err instanceof Error ? err.message : err);
      }
    }

    // ── QBO invoice (Invoice Me) ──
    // Immediate invoice creation keeps accounting and ship hold aligned on day 1.
    if (paymentMethod === "invoice_me" && qboCustomerId) {
      try {
        const dueDate = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
        const qboInvoice = await createQBOInvoice({
          CustomerRef: { value: qboCustomerId },
          DueDate: dueDate,
          BillEmail: email?.trim() ? { Address: email.trim() } : undefined,
          CustomerMemo: {
            value: "Net 10. Please pay before shipment releases. Order remains on ship hold until payment clears.",
          },
          Line: [
            {
              Amount: subtotal,
              DetailType: "SalesItemLineDetail",
              SalesItemLineDetail: {
                ItemRef: { value: QBO_TRADE_SHOW_ITEM_ID, name: "Trade Show" },
                Qty: totalBags,
                UnitPrice: pricePerBag,
              },
              Description: `${qty} ${unitLabel}${qty > 1 ? "s" : ""} (${masterCasesCount} master cases · ${totalBags} bags)`,
            },
            ...(freightAmount > 0
              ? [{
                  Amount: freightAmount,
                  DetailType: "SalesItemLineDetail" as const,
                  SalesItemLineDetail: {
                    ItemRef: { value: QBO_TRADE_SHOW_ITEM_ID, name: "Trade Show" },
                    Qty: 1,
                    UnitPrice: freightAmount,
                  },
                  Description: `Shipping — ${freightLabel}`,
                }]
              : []),
          ],
        });
        qboInvoiceId = typeof qboInvoice?.Id === "string" ? qboInvoice.Id : null;
        qboInvoiceDocNumber = typeof qboInvoice?.DocNumber === "string" ? qboInvoice.DocNumber : null;
        if (qboInvoiceId && email?.trim()) {
          qboInvoiceSent = await sendQBOInvoiceEmail(qboInvoiceId, email.trim());
        }
      } catch (err) {
        console.error("[booth-order] QBO invoice creation failed:", err instanceof Error ? err.message : err);
      }
    }

    // ── HubSpot: upsert contact + create B2B Wholesale deal at PO Received ──
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
          const closeDays = paymentMethod === "pay_now" ? 7 : 14;
          const closeDate = new Date(Date.now() + closeDays * 86400000)
            .toISOString().slice(0, 10);
          const dealName = `Wholesale — ${company_name.trim()} (Booth Order)`;
          hubspotDealId = await createDeal({
            dealname: dealName,
            amount: orderTotal,
            dealstage: HUBSPOT.STAGE_PO_RECEIVED,
            closedate: closeDate,
            contactId: contact.id,
            payment_method: paymentMethod,
            onboarding_complete: false,
            payment_received: false,
            description: [
              `Booth order via usagummies.com/booth, submitted ${orderDate} PT`,
              `${qty} ${unitLabel}${qty > 1 ? "s" : ""} (${masterCasesCount} MC · ${totalBags} bags) × $${pricePerBag.toFixed(2)}/bag${tier === "pallet" ? " landed" : ""}`,
              `Subtotal: $${subtotal.toFixed(2)}`,
              `Shipping: ${freightLabel}`,
              `Order total: $${orderTotal.toFixed(2)}`,
              `Payment method: ${paymentMethod === "pay_now" ? "Pay Now by card (5% prepay discount applied)" : "Invoice Me / Net 10"}`,
              `Pricing tier: ${tier === "pallet" ? "Pallet (LTL freight included in price)" : "Standard (UPS Ground billed separately)"}`,
              qboCustomerId ? `QBO Customer ID: ${qboCustomerId}` : "⚠ QBO customer not created",
              qboInvoiceDocNumber ? `QBO Invoice: ${qboInvoiceDocNumber}${qboInvoiceSent ? " (sent)" : " (created, not emailed)"}` : "",
              shopifyOrderName ? `Shopify Order: ${shopifyOrderName}` : shopifyDraftOrderId ? `Shopify Draft: ${shopifyDraftOrderId}` : "",
              freightError ? `⚠ Freight quote error: ${freightError}` : "",
              "",
              "Ship gate: onboarding_complete=false + payment_received=false. No ship until both flip true.",
            ].filter(Boolean).join("\n"),
          });
          if (hubspotDealId) {
            await createNote({
              body: [
                "<p><b>Booth order submitted</b></p>",
                `<p>Quantity: <b>${qty} ${unitLabel}${qty > 1 ? "s" : ""} (${masterCasesCount} MC · ${totalBags} bags)</b><br/>`,
                `Price: <b>$${pricePerBag.toFixed(2)}/bag</b> × ${totalBags} = <b>$${subtotal.toFixed(2)}</b>${tier === "pallet" ? " <i>(landed)</i>" : ""}<br/>`,
                `Shipping: <b>${freightLabel}</b><br/>`,
                `Order total: <b>$${orderTotal.toFixed(2)}</b><br/>`,
                `Payment: <b>${paymentMethod === "pay_now" ? "Pay Now by card" : "Invoice Me / Net 10"}</b><br/>`,
                `Ship to: ${ship_address || "—"}${ship_city ? `, ${ship_city}` : ""}${ship_state ? ` ${ship_state}` : ""}${ship_zip ? ` ${ship_zip}` : ""}</p>`,
                qboCustomerId ? `<p>QBO Customer: <code>${qboCustomerId}</code></p>` : "",
                qboInvoiceDocNumber ? `<p>QBO Invoice: <code>${qboInvoiceDocNumber}</code>${qboInvoiceSent ? " — emailed" : ""}</p>` : "",
                shopifyOrderName ? `<p>Shopify Order: <code>${shopifyOrderName}</code></p>` : "",
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
      const shippingLine = tier === "pallet"
        ? "Shipping: LTL freight — included in landed price"
        : freightAmount > 0
          ? `Shipping: $${freightAmount.toFixed(2)}${freightDays ? ` (UPS Ground, ~${freightDays} day${freightDays > 1 ? "s" : ""} from Ashford, WA)` : " (UPS Ground from Ashford, WA)"}`
          : "Shipping: UPS Ground from Ashford, WA — final freight on invoice";
      const customerBody = [
        `Hi ${firstName},`,
        ``,
        `Thanks for your order! We received it and we're on it.`,
        ``,
        `── Order summary ──`,
        `Product: All American Gummy Bears — 7.5 oz bag`,
        `Quantity: ${qty} ${unitLabel}${qty > 1 ? "s" : ""} (${masterCasesCount} master case${masterCasesCount > 1 ? "s" : ""} · ${totalBags} bags total)`,
        `Price: $${pricePerBag.toFixed(2)}/bag${tier === "pallet" ? " landed" : ""}${payNowSuffix}`,
        `Subtotal: $${subtotal.toFixed(2)}`,
        shippingLine,
        `Order total: $${orderTotal.toFixed(2)}`,
        `Payment: ${
          paymentMethod === "pay_now"
            ? "Paid by card — thank you!"
            : qboInvoiceSent
              ? `Invoice ${qboInvoiceDocNumber || ""} sent separately (Net 10)`.trim()
              : "Invoice is being prepared now (Net 10)"
        }`,
        ``,
        `── One quick step ──`,
        paymentMethod === "pay_now"
          ? `We just need 5 fast details (30 seconds) so we can get this on the truck. Click here to finish your setup:`
          : qboInvoiceSent
            ? `We just need a quick customer info form so we can release shipment after payment clears. Click here to continue:`
            : `We just need a quick customer info form so we can send your invoice and get this shipped. Click here to continue:`,
        ``,
        `${onboardingUrl}`,
        ``,
        paymentMethod === "pay_now"
          ? `I pack and ship your order personally from our warehouse in Ashford, WA within 2 business days of receiving your info.`
          : qboInvoiceSent
            ? `Your invoice is already on the way. I pack and ship from Ashford, WA as soon as payment clears.`
            : `We'll email your invoice once you complete the form. I pack and ship from Ashford, WA as soon as payment clears.`,
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
          body: `Welcome email sent. Onboarding portal: ${onboardingUrl}. Payment method: ${paymentMethod}. Order total: $${orderTotal.toFixed(2)} (${freightLabel}).`,
          to: email.trim(),
          contactId: hubspotContactId,
          dealId: hubspotDealId ?? undefined,
        });
      } catch {
        // non-fatal
      }
    }

    try {
      const shipTo = [company_name, ship_address, [ship_city, ship_state, ship_zip].filter(Boolean).join(" ")].filter(Boolean).join(" — ");
      const orderRef = shopifyOrderName
        || qboInvoiceDocNumber
        || (shopifyDraftOrderId ? `Draft ${shopifyDraftOrderId.split("/").pop()}` : null)
        || hubspotDealId
        || `Booth-${Date.now()}`;
      await upsertOrder({
        id: [
          "wholesale",
          paymentMethod,
          shopifyOrderId || shopifyDraftOrderId || qboInvoiceId || hubspotDealId || Date.now(),
        ].join(":"),
        channel: "Wholesale",
        order_ref: String(orderRef),
        customer_name: company_name.trim(),
        ship_to: shipTo,
        date: new Date().toISOString().slice(0, 10),
        units: totalBags,
        subtotal,
        shipping_charged: freightAmount,
        total: orderTotal,
        terms: paymentMethod === "pay_now" ? "Prepaid card — ship hold until checkout clears" : "Net 10 — ship hold until QBO payment",
        po_details: [
          {
            sku: "199284624702",
            description: "All American Gummy Bears 7.5 oz bag",
            quantity: totalBags,
            unit_price: pricePerBag,
            packaging_format: tier === "pallet" ? "pallet" : "36-case",
            total: subtotal,
          },
        ],
        packaging_format: tier === "pallet" ? "pallet" : "36-case",
        status: "received",
        notes: [
          paymentMethod === "pay_now" ? "Checkout pending until Shopify payment completes." : "Awaiting invoice payment before ship release.",
          qboCustomerId ? `QBO customer: ${qboCustomerId}` : null,
          qboInvoiceDocNumber ? `QBO invoice: ${qboInvoiceDocNumber}${qboInvoiceSent ? " (sent)" : ""}` : null,
          shopifyOrderName ? `Shopify order: ${shopifyOrderName}` : null,
          shopifyDraftOrderId && !shopifyOrderName ? `Shopify draft: ${shopifyDraftOrderId}` : null,
        ].filter(Boolean).join("\n"),
      });
    } catch (err) {
      console.error("[booth-order] order desk log failed:", err instanceof Error ? err.message : err);
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
      `*Order:* ${qty} ${unitLabel}${qty > 1 ? "s" : ""} (${masterCasesCount} MC · ${totalBags} bags)`,
      `*Price:* $${pricePerBag.toFixed(2)}/bag${tier === "pallet" ? " (Pallet — landed)" : paymentMethod === "pay_now" ? " (Pay Now, 5% prepay discount)" : " (Standard)"}`,
      `*Product Subtotal:* $${subtotal.toFixed(2)}`,
      `*Shipping:* ${freightLabel}`,
      freightError ? `⚠️ Freight quote failed: ${freightError} — re-quote manually` : null,
      `*Order Total:* $${orderTotal.toFixed(2)}`,
      ``,
      ship_address ? `*Ship To:* ${ship_address}, ${ship_city || ""} ${ship_state || ""} ${ship_zip || ""}` : null,
      notes ? `*Notes:* ${notes}` : null,
      ``,
      qboCustomerId ? `*QBO Customer ID:* ${qboCustomerId}` : `⚠️ QBO customer not created — needs manual setup`,
      qboInvoiceDocNumber ? `*QBO Invoice:* ${qboInvoiceDocNumber}${qboInvoiceSent ? " (sent)" : " (created only)"}` : null,
      hubspotDealId ? `*HubSpot Deal:* ${hubspotDealId} (B2B Wholesale → PO Received)` : `⚠️ HubSpot deal not created`,
      paymentMethod === "pay_now"
        ? (shopifyInvoiceUrl
            ? `*💳 Shop Pay checkout:* <${shopifyInvoiceUrl}|${shopifyInvoiceUrl}>`
            : `⚠️ Pay Now requested but Shopify draft order FAILED — follow up manually`)
        : (shopifyOrderName
            ? `*🧾 Shopify order:* ${shopifyOrderName} (payment pending / ship hold)`
            : shopifyDraftOrderId
              ? `*🧾 Shopify draft:* ${shopifyDraftOrderId} (could not complete to order)`
              : `⚠️ Invoice order not mirrored into Shopify — follow up manually`),
      welcomeEmailSent ? `*✉️ Welcome email sent* → onboarding at <${onboardingUrl}|${onboardingUrl}>` : `⚠️ Welcome email NOT sent — follow up manually`,
      ``,
      `*Next steps:*`,
      paymentMethod === "pay_now"
        ? `1. Customer completes 5-field Quick Ship form at onboarding portal`
        : `1. Customer completes Full Setup form at onboarding portal`,
      `2. Onboarding gate flips green in HubSpot`,
      paymentMethod === "pay_now"
        ? `3. Payment already collected by card ✅`
        : qboInvoiceDocNumber
          ? `3. QBO invoice ${qboInvoiceDocNumber}${qboInvoiceSent ? " emailed" : " created"}; customer pays invoice`
          : `3. Create/send QBO invoice manually before shipment`,
      tier === "pallet"
        ? `4. Both gates green → Ben books LTL freight from Ashford, WA (cost absorbed in landed price)`
        : `4. Both gates green → Ben packs and ships from Ashford, WA via UPS Ground`,
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
      freight: {
        amount: freightAmount,
        carrier: freightCarrier,
        service: freightService,
        delivery_days: freightDays,
        label: freightLabel,
        error: freightError,
      },
      order_total: orderTotal,
      payment_method: paymentMethod,
      qbo_customer_id: qboCustomerId,
      qbo_invoice_id: qboInvoiceId,
      qbo_invoice_doc_number: qboInvoiceDocNumber,
      qbo_invoice_sent: qboInvoiceSent,
      hubspot_contact_id: hubspotContactId,
      hubspot_deal_id: hubspotDealId,
      welcome_email_sent: welcomeEmailSent,
      onboarding_url: onboardingUrl,
      // Pay Now path — Shopify Draft Order + checkout URL
      shopify_draft_order_id: shopifyDraftOrderId,
      shopify_order_id: shopifyOrderId,
      shopify_order_name: shopifyOrderName,
      payment_url: shopifyInvoiceUrl,
      message:
        paymentMethod === "pay_now" && shopifyInvoiceUrl
          ? "Order received. Redirecting you to secure checkout…"
          : paymentMethod === "invoice_me" && qboInvoiceSent
            ? "Order submitted successfully. Your invoice and onboarding link are on the way."
            : "Order submitted successfully. Check your email for the onboarding link.",
    });
  } catch (error) {
    console.error("[booth-order] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Order submission failed" }, { status: 500 });
  }
}
