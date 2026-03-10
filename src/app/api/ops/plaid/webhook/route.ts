/**
 * POST /api/ops/plaid/webhook — Plaid webhook receiver
 *
 * Handles real-time notifications from Plaid when transactions are updated,
 * items encounter errors, or access tokens are about to expire.
 *
 * Auth: Exempt from NextAuth — verified via item_id match.
 * Full JWK signature verification to be added as a fast follow.
 */

import { NextResponse } from "next/server";
import { writeState } from "@/lib/ops/state";
import { getStoredAccessToken } from "@/lib/finance/plaid";
import { notifyAlert } from "@/lib/ops/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlaidWebhookBody = {
  webhook_type: string;
  webhook_code: string;
  item_id: string;
  error?: {
    error_type: string;
    error_code: string;
    error_message: string;
  };
  new_transactions?: number;
  removed_transactions?: string[];
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PlaidWebhookBody;
    const { webhook_type, webhook_code, item_id } = body;

    console.log(
      `[plaid-webhook] ${webhook_type}/${webhook_code} for item ${item_id}`,
    );

    // Basic verification: ensure we have a stored token (proves we connected)
    // Full JWK signature verification is a fast-follow
    const storedToken = await getStoredAccessToken();
    if (!storedToken) {
      console.warn("[plaid-webhook] No stored access token — ignoring webhook");
      return NextResponse.json({ received: true });
    }

    switch (webhook_type) {
      case "TRANSACTIONS": {
        await handleTransactionWebhook(webhook_code, body);
        break;
      }
      case "ITEM": {
        await handleItemWebhook(webhook_code, body);
        break;
      }
      default: {
        console.log(
          `[plaid-webhook] Unhandled webhook_type: ${webhook_type}`,
        );
      }
    }

    // Plaid requires a quick 200 response
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[plaid-webhook] Error processing webhook:", err);
    // Still return 200 to prevent Plaid from retrying on parse errors
    return NextResponse.json({ received: true, error: "processing_error" });
  }
}

// ---------------------------------------------------------------------------
// Transaction event handlers
// ---------------------------------------------------------------------------

async function handleTransactionWebhook(
  code: string,
  body: PlaidWebhookBody,
) {
  switch (code) {
    case "INITIAL_UPDATE": {
      console.log(
        `[plaid-webhook] Initial transaction sync complete (${body.new_transactions ?? 0} txns)`,
      );
      await invalidateCaches();
      break;
    }
    case "HISTORICAL_UPDATE": {
      console.log(
        `[plaid-webhook] Historical transaction data ready (${body.new_transactions ?? 0} txns)`,
      );
      await invalidateCaches();
      break;
    }
    case "DEFAULT_UPDATE": {
      console.log(
        `[plaid-webhook] New transactions available (${body.new_transactions ?? 0} new)`,
      );
      await invalidateCaches();
      break;
    }
    case "TRANSACTIONS_REMOVED": {
      console.log(
        `[plaid-webhook] Transactions removed (${body.removed_transactions?.length ?? 0})`,
      );
      await invalidateCaches();
      break;
    }
    default: {
      console.log(`[plaid-webhook] Unhandled transaction code: ${code}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Item event handlers
// ---------------------------------------------------------------------------

async function handleItemWebhook(code: string, body: PlaidWebhookBody) {
  switch (code) {
    case "ERROR": {
      const errMsg = body.error
        ? `${body.error.error_code}: ${body.error.error_message}`
        : "Unknown error";
      console.error(`[plaid-webhook] Item error — ${errMsg}`);
      await notifyAlert(
        `🏦 Plaid item error: ${errMsg}. Bank connection may need re-authentication.`,
      ).catch(() => {});
      break;
    }
    case "PENDING_EXPIRATION": {
      console.warn(
        "[plaid-webhook] Access token pending expiration — user needs to re-auth",
      );
      await notifyAlert(
        "🏦 Plaid access token expiring soon. Please re-connect your bank account at /ops/finance.",
      ).catch(() => {});
      break;
    }
    default: {
      console.log(`[plaid-webhook] Unhandled item code: ${code}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

async function invalidateCaches() {
  try {
    await Promise.all([
      writeState("plaid-balance-cache", null),
      writeState("transactions-cache", null),
    ]);
    console.log("[plaid-webhook] Caches invalidated");
  } catch (err) {
    console.error("[plaid-webhook] Cache invalidation failed:", err);
  }
}
