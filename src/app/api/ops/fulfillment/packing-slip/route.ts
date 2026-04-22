/**
 * Packing Slip Renderer — /api/ops/fulfillment/packing-slip
 *
 * Closes the "wire BUILD #5 packing-slip template into a live route"
 * gap. Ben opens this URL (or POSTs from an automation), gets an HTML
 * packing slip in the USA Gummies red-and-white brand template, hits
 * Cmd+P, and prints to the Brother laser.
 *
 * Two flavors:
 *   GET  — query-param driven, returns rendered HTML for browser print.
 *          Convenient for a bookmarklet-style workflow where Ben types
 *          the order info into a URL bar (or the /ops/shipping button
 *          builds the URL). Minimal required params listed below.
 *   POST — JSON body matching `PackingSlipInput` for agents / scripts.
 *          Returns `{ html, filename, suggestedPrint: "lp -d ..." }`.
 *
 * Auth: session OR bearer CRON_SECRET (matches the rest of /api/ops/fulfillment).
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  packingSlipHtml,
  type PackingSlipInput,
} from "@/lib/ops/html-to-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SHIP_FROM = {
  name: process.env.SHIPSTATION_FROM_COMPANY?.trim() || "USA Gummies",
  street1: process.env.SHIPSTATION_FROM_STREET1?.trim() || "30027 SR 706 E",
  city: process.env.SHIPSTATION_FROM_CITY?.trim() || "Ashford",
  state: process.env.SHIPSTATION_FROM_STATE?.trim() || "WA",
  postalCode: process.env.SHIPSTATION_FROM_POSTALCODE?.trim() || "98304",
  phone: process.env.SHIPSTATION_FROM_PHONE?.trim() || "(307) 209-4928",
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function mergeDefaults(input: Partial<PackingSlipInput>): PackingSlipInput {
  // Narrow validation — enough to catch a broken call without a zod
  // dependency. Route 400s on truly unrecoverable input.
  if (!input.invoiceNumber) throw new Error("invoiceNumber required");
  if (!input.invoiceDate) throw new Error("invoiceDate required");
  if (!input.shipTo?.name) throw new Error("shipTo.name required");
  if (!input.shipTo.street1) throw new Error("shipTo.street1 required");
  if (!input.shipTo.city) throw new Error("shipTo.city required");
  if (!input.shipTo.state) throw new Error("shipTo.state required");
  if (!input.shipTo.postalCode) throw new Error("shipTo.postalCode required");
  if (!Array.isArray(input.lineItems) || input.lineItems.length === 0) {
    throw new Error("lineItems required (non-empty array)");
  }
  return {
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    terms: input.terms,
    dueDate: input.dueDate,
    shipFrom: {
      name: input.shipFrom?.name ?? DEFAULT_SHIP_FROM.name,
      street1: input.shipFrom?.street1 ?? DEFAULT_SHIP_FROM.street1,
      street2: input.shipFrom?.street2,
      city: input.shipFrom?.city ?? DEFAULT_SHIP_FROM.city,
      state: input.shipFrom?.state ?? DEFAULT_SHIP_FROM.state,
      postalCode:
        input.shipFrom?.postalCode ?? DEFAULT_SHIP_FROM.postalCode,
      phone: input.shipFrom?.phone ?? DEFAULT_SHIP_FROM.phone,
    },
    shipTo: input.shipTo,
    lineItems: input.lineItems,
    freightLine: input.freightLine,
    totalOverride: input.totalOverride,
    trackingNumbers: input.trackingNumbers,
    memo: input.memo,
    footer: input.footer,
  };
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const qs = url.searchParams;

  // Minimal GET contract — single-line orders only. The POST path
  // handles multi-line + freight-line + all the extras.
  try {
    const input: Partial<PackingSlipInput> = {
      invoiceNumber: qs.get("invoiceNumber") ?? "",
      invoiceDate: qs.get("invoiceDate") ?? new Date().toISOString().slice(0, 10),
      terms: qs.get("terms") ?? undefined,
      dueDate: qs.get("dueDate") ?? undefined,
      memo: qs.get("memo") ?? undefined,
      trackingNumbers: qs.get("tracking")?.split(",").map((s) => s.trim()).filter(Boolean),
      shipTo: {
        name: qs.get("to.name") ?? "",
        company: qs.get("to.company") ?? undefined,
        attn: qs.get("to.attn") ?? undefined,
        street1: qs.get("to.street1") ?? "",
        street2: qs.get("to.street2") ?? undefined,
        city: qs.get("to.city") ?? "",
        state: (qs.get("to.state") ?? "").toUpperCase(),
        postalCode: qs.get("to.postalCode") ?? "",
        phone: qs.get("to.phone") ?? undefined,
      },
      lineItems: [
        {
          qty: Number.parseInt(qs.get("qty") ?? "1", 10) || 1,
          description: qs.get("item") ?? "All American Gummy Bears — 7.5 oz Bag",
          sub: qs.get("sub") ?? undefined,
          unitPrice: Number.parseFloat(qs.get("unitPrice") ?? "0") || 0,
          unitLabel: qs.get("unitLabel") ?? undefined,
        },
      ],
    };
    const merged = mergeDefaults(input);
    const html = packingSlipHtml(merged);
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: Partial<PackingSlipInput> & { render?: "html" | "json" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const merged = mergeDefaults(body);
    const html = packingSlipHtml(merged);
    const filename = `packing-slip-${merged.invoiceNumber}-${slugify(
      merged.shipTo.name,
    )}.html`;

    // When caller asks for raw HTML, return it unwrapped. JSON is the
    // default so UI + script callers get a structured envelope.
    if (body.render === "html") {
      return new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `inline; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({
      ok: true,
      html,
      filename,
      // Local print hint: pairs with printer-client.ts LASER_PRINTER_NAME.
      suggestedPrint: `lp -d ${process.env.LASER_PRINTER_NAME ?? "Brother_HL_L6200DW_series"} -o media=Letter '<path-to-saved-${filename}>'`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
