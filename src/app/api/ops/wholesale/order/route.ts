/**
 * POST /api/ops/wholesale/order — Create a Shopify Draft Order for wholesale
 *
 * Uses Shopify Admin API to create a draft order with wholesale pricing.
 * Logs the order to Notion "Wholesale Orders" DB if configured.
 */

import { NextRequest, NextResponse } from "next/server";
import { notifyPipeline } from "@/lib/ops/notify";
import { validateRequest, WholesaleOrderSchema } from "@/lib/ops/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || "";
const SHOPIFY_STORE_DOMAIN =
  process.env.SHOPIFY_STORE_DOMAIN ||
  process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
  "";

type LineItem = {
  variantId: string;
  quantity: number;
};

type OrderRequest = {
  customerName: string;
  customerEmail: string;
  companyName?: string;
  lineItems: LineItem[];
  note?: string;
  shippingAddress?: {
    address1: string;
    city: string;
    province: string;
    country: string;
    zip: string;
  };
};

const CREATE_DRAFT_ORDER = `
  mutation draftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        totalPriceSet { shopMoney { amount currencyCode } }
        status
        invoiceUrl
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function POST(req: NextRequest) {
  if (!SHOPIFY_ADMIN_TOKEN || !SHOPIFY_STORE_DOMAIN) {
    return NextResponse.json({ error: "Shopify Admin API not configured" }, { status: 500 });
  }

  const v = await validateRequest(req, WholesaleOrderSchema);
  if (!v.success) return v.response;
  const body = v.data;

  // Build draft order input
  const input: Record<string, unknown> = {
    email: body.customerEmail,
    note: body.note || `Wholesale order for ${body.companyName || body.customerName}`,
    lineItems: body.lineItems.map((li) => ({
      variantId: li.variantId,
      quantity: li.quantity,
    })),
    tags: ["wholesale", "ops-platform"],
  };

  if (body.shippingAddress) {
    input.shippingAddress = {
      ...body.shippingAddress,
      firstName: body.customerName.split(" ")[0] || "",
      lastName: body.customerName.split(" ").slice(1).join(" ") || "",
    };
  }

  try {
    const domain = SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const endpoint = `https://${domain}/admin/api/2024-10/graphql.json`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      body: JSON.stringify({ query: CREATE_DRAFT_ORDER, variables: { input } }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Shopify ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
    }

    const json = await res.json();
    const errors = json.data?.draftOrderCreate?.userErrors;
    if (errors?.length) {
      return NextResponse.json({ error: errors.map((e: { message: string }) => e.message).join(", ") }, { status: 422 });
    }

    const draftOrder = json.data?.draftOrderCreate?.draftOrder;

    // Notify pipeline channel
    try {
      await notifyPipeline(
        `New wholesale order ${draftOrder?.name} from ${body.companyName || body.customerName} (${body.customerEmail}) — ${draftOrder?.totalPriceSet?.shopMoney?.amount} ${draftOrder?.totalPriceSet?.shopMoney?.currencyCode}`
      );
    } catch {
      // Non-critical
    }

    return NextResponse.json({
      success: true,
      draftOrder: {
        id: draftOrder?.id,
        name: draftOrder?.name,
        total: draftOrder?.totalPriceSet?.shopMoney?.amount,
        currency: draftOrder?.totalPriceSet?.shopMoney?.currencyCode,
        status: draftOrder?.status,
        invoiceUrl: draftOrder?.invoiceUrl,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
