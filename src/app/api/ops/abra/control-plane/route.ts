import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  closePO,
  getPurchaseOrderByNumber,
  getPurchaseOrderSummary,
  listPurchaseOrders,
  markDelivered,
  matchPayment,
  shipPO,
  type POStatus,
} from "@/lib/ops/operator/po-pipeline";
import {
  readEmailIntelligenceSummary,
  runEmailIntelligence,
} from "@/lib/ops/operator/email-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ControlPlaneRequest =
  | {
      operation: "po.list";
      statuses?: POStatus[];
    }
  | {
      operation: "po.get";
      poNumber: string;
    }
  | {
      operation: "po.summary";
    }
  | {
      operation: "po.transition";
      poNumber: string;
      transition: "ship" | "deliver" | "match_payment" | "close";
      trackingNumber?: string | null;
      carrier?: string | null;
      shippingCost?: number | null;
      estimatedDelivery?: string | null;
      note?: string | null;
      depositAmount?: number | null;
      depositDate?: string | null;
    }
  | {
      operation: "email_intelligence.run";
      messageIds?: string[];
      includeRecent?: boolean;
      forceSummary?: boolean;
      reprocess?: boolean;
    }
  | {
      operation: "email_intelligence.summary";
    };

function badRequest(message: string, details?: Record<string, unknown>) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      ...(details ? { details } : {}),
    },
    { status: 400 },
  );
}

function normalizePoStatuses(value: unknown): POStatus[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<POStatus>([
    "received",
    "invoice_draft",
    "invoice_sent",
    "production",
    "packing",
    "shipped",
    "delivered",
    "payment_pending",
    "paid",
    "closed",
  ]);
  const statuses = value
    .map((status) => String(status || "").trim())
    .filter((status): status is POStatus => allowed.has(status as POStatus));
  return statuses.length ? statuses : undefined;
}

function asString(value: unknown): string {
  return String(value || "").trim();
}

function asOptionalString(value: unknown): string | null {
  const normalized = asString(value);
  return normalized || null;
}

function asOptionalNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function runOperation(input: ControlPlaneRequest) {
  switch (input.operation) {
    case "po.list": {
      const statuses = normalizePoStatuses(input.statuses);
      const rows = await listPurchaseOrders(statuses);
      return {
        operation: input.operation,
        rows,
        count: rows.length,
      };
    }
    case "po.get": {
      const poNumber = asString(input.poNumber);
      if (!poNumber) throw new Error("poNumber is required");
      const row = await getPurchaseOrderByNumber(poNumber);
      return {
        operation: input.operation,
        found: Boolean(row),
        row,
      };
    }
    case "po.summary": {
      const summary = await getPurchaseOrderSummary();
      return {
        operation: input.operation,
        summary,
      };
    }
    case "po.transition": {
      const poNumber = asString(input.poNumber);
      if (!poNumber) throw new Error("poNumber is required");

      switch (input.transition) {
        case "ship": {
          const row = await shipPO({
            poNumber,
            trackingNumber: asOptionalString(input.trackingNumber),
            carrier: asOptionalString(input.carrier),
            shippingCost: asOptionalNumber(input.shippingCost),
            estimatedDelivery: asOptionalString(input.estimatedDelivery),
            note: asOptionalString(input.note),
          });
          return { operation: input.operation, transition: input.transition, row };
        }
        case "deliver": {
          const row = await markDelivered(poNumber);
          return { operation: input.operation, transition: input.transition, row };
        }
        case "match_payment": {
          const amount = asOptionalNumber(input.depositAmount);
          const depositDate = asString(input.depositDate);
          if (amount == null || !depositDate) {
            throw new Error("depositAmount and depositDate are required for match_payment");
          }
          const row = await matchPayment({
            poNumber,
            depositAmount: amount,
            depositDate,
          });
          return { operation: input.operation, transition: input.transition, row };
        }
        case "close": {
          const row = await closePO(poNumber);
          return { operation: input.operation, transition: input.transition, row };
        }
        default:
          throw new Error(`Unsupported PO transition: ${(input as { transition?: string }).transition || "unknown"}`);
      }
    }
    case "email_intelligence.run": {
      const result = await runEmailIntelligence({
        messageIds: Array.isArray(input.messageIds)
          ? input.messageIds.map((id) => asString(id)).filter(Boolean)
          : undefined,
        includeRecent: input.includeRecent,
        forceSummary: input.forceSummary,
        reprocess: input.reprocess,
      });
      return {
        operation: input.operation,
        result,
      };
    }
    case "email_intelligence.summary": {
      const summary = await readEmailIntelligenceSummary();
      return {
        operation: input.operation,
        summary,
      };
    }
    default:
      throw new Error(`Unsupported operation: ${(input as { operation?: string }).operation || "unknown"}`);
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const input = (await req.json().catch(() => null)) as ControlPlaneRequest | null;
  if (!input || typeof input !== "object") {
    return badRequest("Invalid JSON body");
  }
  if (typeof input.operation !== "string" || !input.operation.trim()) {
    return badRequest("operation is required");
  }

  try {
    const data = await runOperation(input);
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/required|unsupported|invalid/i.test(message)) {
      return badRequest(message);
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
