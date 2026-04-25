/**
 * Booth Order API — /api/booth-order
 *
 * POST — Submit a new wholesale quick order from /booth. Re-quotes UPS Ground
 * freight server-side so the customer can't tamper with the displayed rate.
 * Creates QBO customer + invoice (Invoice Me), mirrors the order into Shopify,
 * logs the order into the internal queue, and notifies Slack + HubSpot.
 *
 * Body (JSON):
 *   company_name, contact_name, email, phone,
 *   ship_address, ship_city, ship_state, ship_zip,
 *   quantity, packaging_type ("case" | "master_carton" | "pallet"),
 *   delivery_method ("shipping" | "in_person"),
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

type PackagingType = "case" | "master_carton" | "pallet";
type DeliveryMethod = "shipping" | "in_person";
type PaymentMethod = "pay_now" | "invoice_me";

const PACKAGING: Record<
  PackagingType,
  {
    label: string;
    unitsPerPack: number;
    packagingFormat: "singles" | "36-case" | "pallet" | "custom";
    shopifyTitle: string;
  }
> = {
  case: {
    label: "Case",
    unitsPerPack: 6,
    packagingFormat: "custom",
    shopifyTitle: "USA Gummies — Case (6 bags)",
  },
  master_carton: {
    label: "Master Case",
    unitsPerPack: 36,
    packagingFormat: "36-case",
    shopifyTitle: "USA Gummies — Master Case (36 bags)",
  },
  pallet: {
    label: "Pallet",
    unitsPerPack: 900,
    packagingFormat: "pallet",
    shopifyTitle: "USA Gummies — Pallet (25 master cases / 900 bags)",
  },
};

function getPackagingType(value: unknown): PackagingType {
  return value === "case" || value === "master_carton" || value === "pallet"
    ? value
    : "case";
}

function getDeliveryMethod(value: unknown): DeliveryMethod {
  return value === "in_person" ? "in_person" : "shipping";
}

function getPaymentMethod(value: unknown): PaymentMethod {
  return value === "pay_now" ? "pay_now" : "invoice_me";
}

function getBasePrice(packagingType: PackagingType, quantity: number): number {
  if (packagingType === "pallet") {
    return 3;
  }
  if (packagingType === "master_carton") {
    return quantity >= 6 ? 3.1 : 3.25;
  }
  return 3.49;
}

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
      quantity,
      packaging_type,
      delivery_method,
      notes,
      payment_method,
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
    if (!phone?.trim()) {
      return NextResponse.json({ error: "Phone is required" }, { status: 400 });
    }
    if (!ship_address?.trim()) {
      return NextResponse.json({ error: "Shipping address is required" }, { status: 400 });
    }
    if (!ship_city?.trim()) {
      return NextResponse.json({ error: "Shipping city is required" }, { status: 400 });
    }
    if (!/^[A-Z]{2}$/.test(String(ship_state ?? "").trim().toUpperCase())) {
      return NextResponse.json({ error: "Enter a valid 2-letter state code" }, { status: 400 });
    }
    if (!/^\d{5}(-\d{4})?$/.test(String(ship_zip ?? "").trim())) {
      return NextResponse.json({ error: "Enter a valid ZIP code" }, { status: 400 });
    }

    const qty = Math.max(1, Number(quantity) || 1);
    const packagingType = getPackagingType(packaging_type);
    const deliveryMethod = getDeliveryMethod(delivery_method);
    const paymentMethod = getPaymentMethod(payment_method);
    const pack = PACKAGING[packagingType];
    const totalBags = qty * pack.unitsPerPack;
    const basePrice = getBasePrice(packagingType, qty);
    const prepayEligible = packagingType === "master_carton";
    const prepayMultiplier =
      paymentMethod === "pay_now" && prepayEligible ? 0.95 : 1;
    const pricePerBag = Math.round(basePrice * prepayMultiplier * 100) / 100;
    const subtotal = Number((totalBags * pricePerBag).toFixed(2));

    // ── Server-side freight handling ──
    // Parcel shipments get a live UPS Ground quote before submit. Pallets are
    // priced landed with freight included. In-person handoff skips freight.
    let freightAmount = 0;
    let freightLabel =
      deliveryMethod === "in_person"
        ? "In-person delivery / handoff"
        : "UPS Ground";
    let freightCarrier: string | null = null;
    let freightService: string | null = null;
    let freightDays: number | null = null;
    let freightError: string | null = null;
    if (deliveryMethod === "shipping") {
      if (!isShipStationConfigured()) {
        return NextResponse.json(
          { error: "Shipping quotes are temporarily unavailable. Please try again in a minute." },
          { status: 503 },
        );
      }

      const rateRes = await getUpsGroundRate({
        toState: String(ship_state).trim().toUpperCase(),
        toZip: String(ship_zip).trim(),
        packagingType,
        quantity: qty,
      });

      if (!rateRes.ok) {
        console.error("[booth-order] freight re-quote failed:", rateRes.error);
        return NextResponse.json(
          { error: rateRes.error || "Shipping quote unavailable" },
          { status: 502 },
        );
      }

      freightAmount = rateRes.quote.rate;
      freightCarrier = rateRes.quote.carrier;
      freightService = rateRes.quote.service;
      freightDays = rateRes.quote.delivery_days;
      freightLabel =
        packagingType === "pallet"
          ? "LTL freight included in pallet price"
          : `${rateRes.quote.service} — $${freightAmount.toFixed(2)}${
              freightDays ? ` (~${freightDays} day${freightDays > 1 ? "s" : ""})` : ""
            }`;
    }
    const orderTotal = Number((subtotal + freightAmount).toFixed(2));

    // Build order details string for QBO Notes field (so Viktor can see order info)
    const orderDate = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
    const qboNotes = [
      `=== WHOLESALE QUICK ORDER ===`,
      `Submitted: ${orderDate} PT`,
      ``,
      `PACK: ${qty} ${pack.label}${qty > 1 ? "s" : ""} (${totalBags} bags total)`,
      `DELIVERY: ${deliveryMethod === "in_person" ? "In-person handoff / local delivery" : freightLabel}`,
      `PRICING: $${pricePerBag.toFixed(2)}/unit${prepayEligible && paymentMethod === "pay_now" ? " (5% prepay discount applied)" : ""}`,
      `SUBTOTAL: $${subtotal.toFixed(2)}`,
      `SHIPPING: ${deliveryMethod === "in_person" ? "N/A" : freightLabel}`,
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
        const pricePerPack = Number((pack.unitsPerPack * pricePerBag).toFixed(2));
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
          deliveryMethod === "in_person"
            ? "In-person delivery / handoff"
            : packagingType === "pallet"
              ? "LTL freight included in pallet price"
            : freightAmount > 0
              ? `UPS Ground (${qty} ${pack.label.toLowerCase()}${qty > 1 ? "s" : ""})`
              : "Shipping";
        const draftInput: Record<string, unknown> = {
          email: email.trim(),
          note: `Wholesale quick order (Pay Now). ${qty} ${pack.label.toLowerCase()}${qty > 1 ? "s" : ""} (${totalBags} bags) @ $${pricePerBag.toFixed(2)}/unit. Delivery: ${deliveryMethod === "in_person" ? "in-person handoff" : freightLabel}. QBO customer: ${qboCustomerId || "pending"}.`,
          tags: ["wholesale", "quick_order", "pay_now", packagingType, deliveryMethod],
          lineItems: [
            {
              title: pack.shopifyTitle,
              originalUnitPriceWithCurrency: { amount: pricePerPack.toFixed(2), currencyCode: "USD" },
              quantity: qty,
              requiresShipping: deliveryMethod === "shipping",
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
    // Invoice-based quick orders need to appear in a real operational queue.
    // We create a draft, then complete it as payment-pending so it shows up
    // in Shopify Orders while staying on a payment hold until payment clears.
    if (paymentMethod === "invoice_me" && shopifyDomain && shopifyToken) {
      try {
        const pricePerPack = Number((pack.unitsPerPack * pricePerBag).toFixed(2));
        const firstName = contact_name.split(/\s+/)[0] || contact_name;
        const lastName = contact_name.split(/\s+/).slice(1).join(" ") || "";
        const shippingTitle =
          deliveryMethod === "in_person"
            ? "In-person delivery / handoff"
            : packagingType === "pallet"
              ? "LTL freight included in pallet price"
            : `UPS Ground (${qty} ${pack.label.toLowerCase()}${qty > 1 ? "s" : ""})`;

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
            "Wholesale quick order (Invoice Me / Net 10).",
            `${qty} ${pack.label.toLowerCase()}${qty > 1 ? "s" : ""} (${totalBags} bags) @ $${pricePerBag.toFixed(2)}/unit.`,
            `Delivery: ${deliveryMethod === "in_person" ? "In-person handoff" : freightLabel}.`,
            "PAYMENT HOLD: release after QBO invoice payment. No onboarding gate.",
            qboCustomerId ? `QBO customer: ${qboCustomerId}.` : "QBO customer: pending.",
          ].join(" "),
          tags: ["wholesale", "quick_order", "invoice_me", packagingType, deliveryMethod, "awaiting_payment", "ship_hold"],
          lineItems: [
            {
              title: pack.shopifyTitle,
              originalUnitPriceWithCurrency: {
                amount: pricePerPack.toFixed(2),
                currencyCode: "USD",
              },
              quantity: qty,
              requiresShipping: deliveryMethod === "shipping",
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
            value: "Net 10. This submit is a real order. No onboarding step is required; shipment or handoff releases per payment terms.",
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
              Description: `${qty} ${pack.label}${qty > 1 ? "s" : ""} (${totalBags} bags)`,
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
            onboarding_complete: true,
            payment_received: false,
            description: [
              `Booth order via usagummies.com/booth, submitted ${orderDate} PT`,
              `${qty} ${pack.label}${qty > 1 ? "s" : ""} (${totalBags} bags) × $${pricePerBag.toFixed(2)}/unit`,
              `Subtotal: $${subtotal.toFixed(2)}`,
              `Delivery: ${deliveryMethod === "in_person" ? "In-person handoff" : freightLabel}`,
              `Order total: $${orderTotal.toFixed(2)}`,
              `Payment method: ${paymentMethod === "pay_now" ? `Pay Now by card${prepayEligible ? " (5% prepay discount applied)" : ""}` : "Invoice Me / Net 10"}`,
              `No onboarding gate. Process immediately after submit; release on payment terms.`,
              qboCustomerId ? `QBO Customer ID: ${qboCustomerId}` : "⚠ QBO customer not created",
              qboInvoiceDocNumber ? `QBO Invoice: ${qboInvoiceDocNumber}${qboInvoiceSent ? " (sent)" : " (created, not emailed)"}` : "",
              shopifyOrderName ? `Shopify Order: ${shopifyOrderName}` : shopifyDraftOrderId ? `Shopify Draft: ${shopifyDraftOrderId}` : "",
            ].filter(Boolean).join("\n"),
          });
          if (hubspotDealId) {
            await createNote({
              body: [
                "<p><b>Booth order submitted</b></p>",
                `<p>Quantity: <b>${qty} ${pack.label}${qty > 1 ? "s" : ""} (${totalBags} bags)</b><br/>`,
                `Price: <b>$${pricePerBag.toFixed(2)}/unit</b> × ${totalBags} = <b>$${subtotal.toFixed(2)}</b><br/>`,
                `Delivery: <b>${deliveryMethod === "in_person" ? "In-person handoff" : freightLabel}</b><br/>`,
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
    try {
      const firstName = contact_name.split(/\s+/)[0] || contact_name;
      const customerSubject = `USA Gummies — Order received (${company_name.trim()})`;
      const payNowSuffix =
        paymentMethod === "pay_now" && prepayEligible
          ? " (5% prepay discount applied)"
          : "";
      const deliveryLine =
        deliveryMethod === "in_person"
          ? "Delivery: In-person handoff / local delivery"
          : packagingType === "pallet"
            ? "Shipping: Included in pallet price (LTL freight included)"
          : freightAmount > 0
            ? `Shipping: $${freightAmount.toFixed(2)}${freightDays ? ` (UPS Ground, ~${freightDays} day${freightDays > 1 ? "s" : ""})` : " (UPS Ground)"}`
            : "Shipping: UPS Ground";
      const customerBody = [
        `Hi ${firstName},`,
        ``,
        `Thanks for your order. We received it and it is now in our wholesale queue.`,
        ``,
        `── Order summary ──`,
        `Product: All American Gummy Bears — 7.5 oz bag`,
        `Quantity: ${qty} ${pack.label}${qty > 1 ? "s" : ""} (${totalBags} bags total)`,
        `Price: $${pricePerBag.toFixed(2)}/unit${payNowSuffix}`,
        `Subtotal: $${subtotal.toFixed(2)}`,
        deliveryLine,
        `Order total: $${orderTotal.toFixed(2)}`,
        `Payment: ${
          paymentMethod === "pay_now"
            ? "Card checkout pending — complete the secure checkout that opens next"
            : qboInvoiceSent
              ? `Invoice ${qboInvoiceDocNumber || ""} sent separately (Net 10)`.trim()
              : "Invoice is being prepared now (Net 10)"
        }`,
        ``,
        paymentMethod === "pay_now"
          ? deliveryMethod === "in_person"
            ? `Your order is ready for in-person handoff as soon as checkout clears.`
            : `We pack and ship your order personally as soon as checkout clears.`
          : qboInvoiceSent
            ? deliveryMethod === "in_person"
              ? `Your invoice is already on the way. We can hand off inventory as soon as payment clears.`
              : `Your invoice is already on the way. We pack and ship as soon as payment clears.`
            : `We'll email your invoice shortly. We release the order as soon as payment clears.`,
        ``,
        `No extra onboarding step is required for this order.`,
        ``,
        `Questions? Reply to this email — we'll get back to you.`,
        ``,
        `Thanks again,`,
        `The USA Gummies team`,
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
          body: `Order receipt email sent. Payment method: ${paymentMethod}. Order total: $${orderTotal.toFixed(2)}. Delivery: ${deliveryMethod}.`,
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
        terms:
          paymentMethod === "pay_now"
            ? deliveryMethod === "in_person"
              ? "Prepaid card — handoff when checkout clears"
              : "Prepaid card — ship once checkout clears"
            : deliveryMethod === "in_person"
              ? "Net 10 — awaiting invoice payment before handoff"
              : "Net 10 — awaiting invoice payment before shipment",
        po_details: [
          {
            sku: "199284624702",
            description: "All American Gummy Bears 7.5 oz bag",
            quantity: totalBags,
            unit_price: pricePerBag,
            packaging_format: pack.packagingFormat,
            total: subtotal,
          },
        ],
        packaging_format: pack.packagingFormat,
        status: "received",
        notes: [
          deliveryMethod === "in_person"
            ? "In-person delivery / handoff selected."
            : `Shipping selected: ${freightLabel}`,
          paymentMethod === "pay_now"
            ? "Checkout pending until Shopify payment completes."
            : "Awaiting invoice payment before release.",
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
      `🧾 *NEW WHOLESALE QUICK ORDER — ${methodTag}*`,
      ``,
      `*Company:* ${company_name}`,
      `*Contact:* ${contact_name}`,
      `*Email:* ${email}`,
      phone ? `*Phone:* ${phone}` : null,
      ``,
      `*Order:* ${qty} ${pack.label}${qty > 1 ? "s" : ""} (${totalBags} bags)`,
      `*Price:* $${pricePerBag.toFixed(2)}/unit${paymentMethod === "pay_now" && prepayEligible ? " (5% prepay discount)" : ""}`,
      `*Product Subtotal:* $${subtotal.toFixed(2)}`,
      `*Delivery:* ${deliveryMethod === "in_person" ? "In-person handoff" : freightLabel}`,
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
      welcomeEmailSent ? `*✉️ Receipt email sent*` : `⚠️ Welcome email NOT sent — follow up manually`,
      ``,
      `*Next steps:*`,
      paymentMethod === "pay_now"
        ? `1. Customer completes Shopify checkout`
        : qboInvoiceDocNumber
          ? `1. Customer pays QBO invoice ${qboInvoiceDocNumber}`
          : `1. Create/send QBO invoice manually`,
      paymentMethod === "pay_now"
        ? `2. Release ${deliveryMethod === "in_person" ? "handoff" : "shipment"} once payment clears`
        : `2. Release ${deliveryMethod === "in_person" ? "handoff" : "shipment"} once payment clears`,
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
      quantity: qty,
      packaging_type: packagingType,
      delivery_method: deliveryMethod,
      total_bags: totalBags,
      price_per_bag: pricePerBag,
      subtotal,
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
      // Pay Now path — Shopify Draft Order + checkout URL
      shopify_draft_order_id: shopifyDraftOrderId,
      shopify_order_id: shopifyOrderId,
      shopify_order_name: shopifyOrderName,
      payment_url: shopifyInvoiceUrl,
      message:
        paymentMethod === "pay_now" && shopifyInvoiceUrl
          ? "Order received. Redirecting you to secure checkout…"
          : paymentMethod === "invoice_me" && qboInvoiceSent
            ? "Order submitted successfully. Your invoice is on the way."
            : "Order submitted successfully. No extra onboarding step is required.",
    });
  } catch (error) {
    console.error("[booth-order] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Order submission failed" }, { status: 500 });
  }
}
