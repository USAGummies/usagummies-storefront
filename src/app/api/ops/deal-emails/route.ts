/**
 * GET /api/ops/deal-emails — Latest email thread per pipeline deal
 *
 * For each pipeline lead (from Notion), searches Gmail for the most recent
 * email thread involving that contact. Returns thread snippets for the
 * Pipeline & Deals page email integration.
 *
 * Query params:
 *   ?email=foo@bar.com  — single contact lookup
 *   (no params)         — batch lookup for all active pipeline leads
 *
 * Protected by middleware (requires JWT session).
 */

import { NextRequest, NextResponse } from "next/server";
import { searchEmails } from "@/lib/ops/gmail-reader";
import { readState, writeState } from "@/lib/ops/state";
import type { CacheEnvelope } from "@/lib/amazon/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DealEmailThread = {
  contactEmail: string;
  latestEmail: {
    id: string;
    threadId: string;
    from: string;
    to: string;
    subject: string;
    date: string;
    snippet: string; // first 200 chars of body
  } | null;
  threadCount: number;
  lastActivity: string | null;
};

type DealEmailsResponse = {
  threads: DealEmailThread[];
  generatedAt: string;
  /** Budget-ready: null until post-funding email marketing budget is set */
  budget: null;
};

// ---------------------------------------------------------------------------
// Gmail availability check
// ---------------------------------------------------------------------------

function isGmailConfigured(): boolean {
  return !!(
    process.env.GMAIL_SERVICE_ACCOUNT_JSON ||
    (process.env.GMAIL_OAUTH_CLIENT_ID &&
      process.env.GMAIL_OAUTH_CLIENT_SECRET &&
      process.env.GMAIL_OAUTH_REFRESH_TOKEN)
  );
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Single contact email lookup
// ---------------------------------------------------------------------------

async function lookupContact(email: string): Promise<DealEmailThread> {
  try {
    const messages = await searchEmails(`from:${email} OR to:${email}`, 5);
    if (messages.length === 0) {
      return {
        contactEmail: email,
        latestEmail: null,
        threadCount: 0,
        lastActivity: null,
      };
    }

    const latest = messages[0];
    return {
      contactEmail: email,
      latestEmail: {
        id: latest.id,
        threadId: latest.threadId,
        from: latest.from,
        to: latest.to,
        subject: latest.subject,
        date: latest.date,
        snippet: (latest.body || "").slice(0, 200),
      },
      threadCount: messages.length,
      lastActivity: latest.date,
    };
  } catch (err) {
    console.error(`[deal-emails] Lookup failed for ${email}:`, err);
    return {
      contactEmail: email,
      latestEmail: null,
      threadCount: 0,
      lastActivity: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Batch lookup — fetch pipeline leads from the pipeline API
// ---------------------------------------------------------------------------

async function getActiveLeadEmails(): Promise<string[]> {
  try {
    // Fetch from our own pipeline endpoint
    const baseUrl =
      process.env.NEXTAUTH_URL ||
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");
    const res = await fetch(`${baseUrl}/api/ops/pipeline`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];

    const data = await res.json();
    const emails: string[] = [];

    // Extract emails from all stages
    if (data.stages && typeof data.stages === "object") {
      for (const leads of Object.values(data.stages)) {
        if (Array.isArray(leads)) {
          for (const lead of leads) {
            const email = (lead as { email?: string }).email;
            if (email && email.includes("@")) {
              emails.push(email);
            }
          }
        }
      }
    }

    // Deduplicate
    return [...new Set(emails)].slice(0, 30); // Cap at 30 to avoid Gmail rate limits
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  if (!isGmailConfigured()) {
    return NextResponse.json({
      threads: [],
      generatedAt: new Date().toISOString(),
      budget: null,
      error: "Gmail API not configured",
    });
  }

  const { searchParams } = new URL(request.url);
  const singleEmail = searchParams.get("email");

  try {
    // Single contact lookup — no caching
    if (singleEmail) {
      const thread = await lookupContact(singleEmail);
      return NextResponse.json({
        threads: [thread],
        generatedAt: new Date().toISOString(),
        budget: null,
      });
    }

    // Batch lookup — check cache first
    const cached = await readState<CacheEnvelope<DealEmailsResponse> | null>(
      "deal-emails-cache",
      null,
    );
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }

    // Get active lead emails from pipeline
    const emails = await getActiveLeadEmails();
    if (emails.length === 0) {
      const result: DealEmailsResponse = {
        threads: [],
        generatedAt: new Date().toISOString(),
        budget: null,
      };
      return NextResponse.json(result);
    }

    // Look up each contact (sequential to avoid Gmail rate limits)
    const threads: DealEmailThread[] = [];
    for (const email of emails) {
      const thread = await lookupContact(email);
      threads.push(thread);
    }

    // Sort by most recent activity
    threads.sort((a, b) => {
      if (!a.lastActivity && !b.lastActivity) return 0;
      if (!a.lastActivity) return 1;
      if (!b.lastActivity) return -1;
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    });

    const result: DealEmailsResponse = {
      threads,
      generatedAt: new Date().toISOString(),
      budget: null,
    };

    // Cache
    await writeState("deal-emails-cache", {
      data: result,
      cachedAt: Date.now(),
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[deal-emails] Failed:", err);
    return NextResponse.json(
      {
        threads: [],
        generatedAt: new Date().toISOString(),
        budget: null,
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}
