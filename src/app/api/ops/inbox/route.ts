/**
 * GET /api/ops/inbox — Unified communications inbox
 *
 * Parallel fetch from all sources (Email, Slack, B2B, Shopify, Amazon),
 * merged and sorted by date.
 *
 * Query params:
 *   ?source=all|email|slack|b2b|shopify|amazon
 *   &limit=50
 *   &unread=true
 *
 * Protected by middleware (requires JWT session).
 */

import { NextResponse } from "next/server";
import { readState, writeState } from "@/lib/ops/state";
import type { CacheEnvelope } from "@/lib/amazon/types";
import type { CommMessage, InboxSummary } from "@/lib/comms/types";
import { fetchSlackMessages, isSlackConfigured } from "@/lib/comms/slack-reader";
import {
  fetchShopifyCustomerMessages,
  isShopifyCustomerConfigured,
} from "@/lib/comms/shopify-customers";
import {
  fetchAmazonBuyerMessages,
  isAmazonConfigured,
} from "@/lib/comms/amazon-messages";
import { fetchB2BPipelineComms } from "@/lib/comms/b2b-comms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Email adapter (wraps Gmail reader, handles graceful failures)
// ---------------------------------------------------------------------------

async function fetchEmailMessages(limit = 20): Promise<CommMessage[]> {
  try {
    // Dynamic import to avoid failing when gmail deps aren't configured
    const { listEmails } = await import("@/lib/ops/gmail-reader");
    const emails = await listEmails({ count: limit, unreadOnly: false });

    return emails.map((e) => ({
      id: `email-${e.id}`,
      source: "email" as const,
      from: e.from,
      subject: e.subject,
      snippet: e.snippet,
      date: new Date(e.date).toISOString(),
      read: !e.labelIds.includes("UNREAD"),
      threadId: e.threadId ? `email-thread-${e.threadId}` : undefined,
      priority: categorizeEmailPriority(e.from, e.subject),
      category: categorizeEmail(e.from, e.subject),
    }));
  } catch {
    // Gmail not configured — return empty
    return [];
  }
}

function categorizeEmailPriority(from: string, subject: string): CommMessage["priority"] {
  const lower = (from + " " + subject).toLowerCase();
  if (lower.includes("urgent") || lower.includes("asap") || lower.includes("critical")) {
    return "high";
  }
  if (lower.includes("faire") || lower.includes("wholesale") || lower.includes("order")) {
    return "high";
  }
  return "normal";
}

function categorizeEmail(from: string, subject: string): CommMessage["category"] {
  const lower = (from + " " + subject).toLowerCase();
  if (lower.includes("faire") || lower.includes("wholesale") || lower.includes("buyer")) {
    return "sales";
  }
  if (lower.includes("refund") || lower.includes("return") || lower.includes("complaint")) {
    return "support";
  }
  if (lower.includes("invoice") || lower.includes("payment") || lower.includes("tax")) {
    return "finance";
  }
  if (lower.includes("amazon") || lower.includes("shopify") || lower.includes("inventory")) {
    return "operations";
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sourceFilter = url.searchParams.get("source") || "all";
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  const unreadOnly = url.searchParams.get("unread") === "true";

  // Check cache (for "all" requests only)
  if (sourceFilter === "all" && !unreadOnly) {
    const cached = await readState<CacheEnvelope<InboxSummary> | null>(
      "inbox-unified-cache",
      null,
    );
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }
  }

  // Determine which sources to fetch
  const fetchSources = {
    email: sourceFilter === "all" || sourceFilter === "email",
    slack: (sourceFilter === "all" || sourceFilter === "slack") && isSlackConfigured(),
    b2b: sourceFilter === "all" || sourceFilter === "b2b",
    shopify: (sourceFilter === "all" || sourceFilter === "shopify") && isShopifyCustomerConfigured(),
    amazon: (sourceFilter === "all" || sourceFilter === "amazon") && isAmazonConfigured(),
  };

  // Parallel fetch from all enabled sources
  const [emailMsgs, slackMsgs, b2bMsgs, shopifyMsgs, amazonMsgs] =
    await Promise.allSettled([
      fetchSources.email ? fetchEmailMessages(20) : Promise.resolve([]),
      fetchSources.slack ? fetchSlackMessages(20) : Promise.resolve([]),
      fetchSources.b2b ? fetchB2BPipelineComms(15) : Promise.resolve([]),
      fetchSources.shopify ? fetchShopifyCustomerMessages(15) : Promise.resolve([]),
      fetchSources.amazon ? fetchAmazonBuyerMessages(10) : Promise.resolve([]),
    ]);

  // Merge all messages
  const allEmails = emailMsgs.status === "fulfilled" ? emailMsgs.value : [];
  const allSlack = slackMsgs.status === "fulfilled" ? slackMsgs.value : [];
  const allB2B = b2bMsgs.status === "fulfilled" ? b2bMsgs.value : [];
  const allShopify = shopifyMsgs.status === "fulfilled" ? shopifyMsgs.value : [];
  const allAmazon = amazonMsgs.status === "fulfilled" ? amazonMsgs.value : [];

  let allMessages = [
    ...allEmails,
    ...allSlack,
    ...allB2B,
    ...allShopify,
    ...allAmazon,
  ];

  // Filter unread if requested
  if (unreadOnly) {
    allMessages = allMessages.filter((m) => !m.read);
  }

  // Sort by date descending, apply limit
  allMessages.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  allMessages = allMessages.slice(0, limit);

  // Count unread per source
  const countUnread = (msgs: CommMessage[]) => msgs.filter((m) => !m.read).length;
  const unreadCount = {
    email: countUnread(allEmails),
    slack: countUnread(allSlack),
    b2b: countUnread(allB2B),
    shopify: countUnread(allShopify),
    amazon: countUnread(allAmazon),
    total: 0,
  };
  unreadCount.total =
    unreadCount.email + unreadCount.slack + unreadCount.b2b +
    unreadCount.shopify + unreadCount.amazon;

  const result: InboxSummary = {
    messages: allMessages,
    unreadCount,
    lastUpdated: new Date().toISOString(),
  };

  // Cache for "all" requests
  if (sourceFilter === "all" && !unreadOnly) {
    await writeState("inbox-unified-cache", { data: result, cachedAt: Date.now() });
  }

  return NextResponse.json(result);
}
