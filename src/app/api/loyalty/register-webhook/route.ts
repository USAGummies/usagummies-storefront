/**
 * POST /api/loyalty/register-webhook
 *
 * One-time endpoint to register the Shopify orders/paid webhook.
 * Protected by CRON_SECRET header — only callable by admin.
 *
 * Usage:
 *   curl -X POST https://www.usagummies.com/api/loyalty/register-webhook \
 *     -H "Authorization: Bearer $CRON_SECRET"
 */

import { NextResponse } from "next/server";
import { registerWebhook, adminRequest } from "@/lib/shopify/admin";

function json(data: unknown, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// List existing webhooks to check if already registered
const WEBHOOKS_QUERY = /* GraphQL */ `
  query {
    webhookSubscriptions(first: 50) {
      nodes {
        id
        topic
        endpoint {
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
        }
      }
    }
  }
`;

export async function POST(req: Request) {
  // Auth check
  const authHeader = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (!cronSecret || !authHeader.includes(cronSecret)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com";
  const callbackUrl = `${siteUrl}/api/loyalty/webhook`;

  // Check if webhook already exists
  const existing = await adminRequest<{
    webhookSubscriptions: {
      nodes: Array<{
        id: string;
        topic: string;
        endpoint: { callbackUrl: string };
      }>;
    };
  }>(WEBHOOKS_QUERY);

  if (existing.ok && existing.data) {
    const alreadyRegistered = existing.data.webhookSubscriptions.nodes.find(
      (w) => w.topic === "ORDERS_PAID" && w.endpoint?.callbackUrl === callbackUrl,
    );

    if (alreadyRegistered) {
      return json({
        ok: true,
        message: "Webhook already registered",
        webhookId: alreadyRegistered.id,
        topic: alreadyRegistered.topic,
        callbackUrl: alreadyRegistered.endpoint.callbackUrl,
      });
    }
  }

  // Register new webhook
  const result = await registerWebhook("ORDERS_PAID", callbackUrl);

  if (!result.ok) {
    return json({ ok: false, error: result.error }, 500);
  }

  console.info("[loyalty] Webhook registered:", result.webhookId, "→", callbackUrl);

  return json({
    ok: true,
    message: "Webhook registered successfully",
    webhookId: result.webhookId,
    topic: "ORDERS_PAID",
    callbackUrl,
  });
}
