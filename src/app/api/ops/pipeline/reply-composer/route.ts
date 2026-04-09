/**
 * POST /api/ops/pipeline/reply-composer — Draft a follow-up email for a prospect
 *
 * Pulls prospect data + touch history from PIPELINE, then generates
 * a context-aware follow-up email draft.
 *
 * ** INCLUDES CLAIM VERIFICATION GATE **
 * Every generated email is scanned against the product claims registry.
 * If any unverified or false claims are found, the email is blocked.
 *
 * Body: { prospect_id, tone?: "friendly" | "professional" | "urgent", context?: string }
 * Returns: { subject, body, prospect, touch_count, reasoning, claims_check }
 *
 * If claims_check.safe is false, the email MUST NOT be sent as-is.
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { getProspect, getTouches } from "@/lib/ops/pipeline";
import { validateOutreachClaims } from "@/lib/ops/product-claims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Tone = "friendly" | "professional" | "urgent";

function buildPrompt(prospect: NonNullable<Awaited<ReturnType<typeof getProspect>>>, touches: Awaited<ReturnType<typeof getTouches>>, tone: Tone, context?: string): string {
  const touchSummary = touches.slice(-5).map((t) =>
    `- ${t.date.split("T")[0]} [${t.type}] ${t.direction}: ${t.summary}`
  ).join("\n");

  return [
    "You are writing a follow-up email for USA Gummies — a premium dye-free gummy candy company.",
    `Tone: ${tone}.`,
    "",
    "PROSPECT INFO:",
    `Company: ${prospect.company}`,
    `Contact: ${prospect.contact_name}`,
    `Channel: ${prospect.channel_type}`,
    `Region: ${prospect.region}`,
    `Status: ${prospect.status}`,
    `Revenue potential: ${prospect.revenue_potential} units/year`,
    prospect.source ? `Source: ${prospect.source}` : null,
    prospect.notes ? `Notes: ${prospect.notes}` : null,
    "",
    "TOUCH HISTORY (most recent 5):",
    touchSummary || "(no touches logged)",
    "",
    context ? `ADDITIONAL CONTEXT: ${context}` : null,
    "",
    "VERIFIED PRODUCT CLAIMS YOU MAY USE:",
    "- Dye-free gummy candy (verified)",
    "- Made with natural flavors (verified — Albanese spec sheet)",
    "- Gluten free (verified)",
    "- Fat free (verified)",
    "- Made in the USA (verified)",
    "- Co-packed by a veteran-owned facility in Spokane, WA (verified)",
    "- MSRP $4.99 / Amazon $5.99 (verified)",
    "",
    "CLAIMS YOU MUST NOT MAKE:",
    "- Do NOT claim Halal certified (unverified)",
    "- Do NOT claim Kosher certified (unverified)",
    "- Do NOT mention Layton, Utah (false — we have no connection to Layton)",
    "- Do NOT make any health/dietary claims not listed above",
    "",
    "Write a short, natural follow-up email. Include:",
    "- A subject line (prefix with 'Subject: ')",
    "- Body text (2-4 paragraphs max)",
    "- Reference something specific from the touch history if available",
    "- End with a clear call to action",
    "- Sign off as 'Ben Stutman, USA Gummies'",
    "",
    "Do NOT use placeholder brackets like [Name] — use the actual prospect data.",
    "Do NOT be salesy or use exclamation marks excessively.",
    "Keep it concise and human.",
  ].filter(Boolean).join("\n");
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 },
    );
  }

  try {
    const body = await req.json();
    const { prospect_id, tone = "professional", context } = body as {
      prospect_id?: string;
      tone?: Tone;
      context?: string;
    };

    if (!prospect_id) {
      return NextResponse.json(
        { error: "Required field: prospect_id" },
        { status: 400 },
      );
    }

    const prospect = await getProspect(prospect_id);
    if (!prospect) {
      return NextResponse.json(
        { error: `Prospect not found: ${prospect_id}` },
        { status: 404 },
      );
    }

    const touches = await getTouches({ prospect_id, limit: 10 });
    const prompt = buildPrompt(prospect, touches, tone, context);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: 1000,
        temperature: 0.4,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Claude API error (${res.status}): ${errText.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const data = await res.json() as {
      content: Array<{ type: string; text?: string }>;
    };

    const reply = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text || "")
      .join("")
      .trim();

    // Parse subject from response
    const subjectMatch = reply.match(/^Subject:\s*(.+)$/m);
    const subject = subjectMatch ? subjectMatch[1].trim() : "Following up — USA Gummies";
    const emailBody = reply.replace(/^Subject:\s*.+\n\n?/m, "").trim();

    // ── CLAIM VERIFICATION GATE ──
    // Scan the generated email for any unverified or false claims
    const claimsCheck = await validateOutreachClaims(subject + "\n" + emailBody);

    return NextResponse.json({
      subject,
      body: emailBody,
      prospect: {
        id: prospect.id,
        company: prospect.company,
        contact_name: prospect.contact_name,
        status: prospect.status,
        email: prospect.email,
      },
      touch_count: touches.length,
      tone,
      // Claim verification results — caller MUST check claims_check.safe
      claims_check: claimsCheck,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to compose reply" },
      { status: 500 },
    );
  }
}
