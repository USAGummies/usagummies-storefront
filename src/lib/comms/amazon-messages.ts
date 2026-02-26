/**
 * Amazon Buyer Message Reader — USA Gummies
 *
 * Reads buyer messages via SP-API Messaging endpoint.
 * Rate limited: 1 req/sec. Heavily cached (30-min TTL).
 *
 * Note: Amazon Messaging API requires additional SP-API authorization
 * and may not be available for all seller accounts. Falls back gracefully.
 */

import type { CommMessage } from "./types";
import { isAmazonConfigured, getAccessToken } from "@/lib/amazon/sp-api";

const SP_API_ENDPOINT = () =>
  process.env.SP_API_ENDPOINT || "https://sellingpartnerapi-na.amazon.com";

export { isAmazonConfigured };

// ---------------------------------------------------------------------------
// Amazon Messaging API (may not be available for all sellers)
// ---------------------------------------------------------------------------

type AmazonMessage = {
  messageId: string;
  subject: string;
  messageText: string;
  senderEmail?: string;
  creationDate: string;
};

/**
 * Fetch recent Amazon buyer messages.
 * This uses the Messaging API which requires specific SP-API permissions.
 * Falls back to empty array if not authorized.
 */
export async function fetchAmazonBuyerMessages(limit = 10): Promise<CommMessage[]> {
  if (!isAmazonConfigured()) return [];

  try {
    const accessToken = await getAccessToken();
    const marketplaceId = process.env.MARKETPLACE_ID || "ATVPDKIKX0DER";

    // Try the messaging API
    const url = new URL("/messaging/v1/orders", SP_API_ENDPOINT());
    url.searchParams.set("marketplaceIds", marketplaceId);

    const res = await fetch(url.toString(), {
      headers: {
        "x-amz-access-token": accessToken,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      // 403/401 = not authorized for messaging API — fall back silently
      if (res.status === 403 || res.status === 401) {
        return [];
      }
      return [];
    }

    const data = await res.json();
    const messages: AmazonMessage[] = data?.payload?.messages || [];

    return messages.slice(0, limit).map((msg) => ({
      id: `amazon-${msg.messageId}`,
      source: "amazon_buyer" as const,
      from: msg.senderEmail || "Amazon Buyer",
      subject: msg.subject || "Buyer Message",
      snippet: (msg.messageText || "").slice(0, 200),
      date: msg.creationDate,
      read: false,
      priority: "normal" as const,
      category: "support" as const,
    }));
  } catch {
    // Messaging API not available — return empty
    return [];
  }
}
