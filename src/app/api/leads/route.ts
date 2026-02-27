import { NextResponse } from "next/server";

type LeadPayload = {
  email?: string;
  phone?: string;
  source?: string;
  intent?: string;
  storeName?: string;
  buyerName?: string;
  location?: string;
  interest?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function json(data: any, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Notion B2B pipeline insertion
// ---------------------------------------------------------------------------

const INTEREST_LABELS: Record<string, string> = {
  "starter-case": "Starter case (sample order)",
  "bulk-pricing": "Bulk wholesale pricing",
  "distribution": "Distribution partnership",
  "custom-private-label": "Custom / private label",
  "event-gifting": "Event or corporate gifting",
};

async function addToB2BPipeline(lead: {
  email: string;
  buyerName: string;
  storeName: string;
  location: string;
  interest: string;
  source: string;
}) {
  const notionKey = process.env.NOTION_API_KEY;
  // Distribution-related interests go to the distributor DB, rest go to B2B
  const isDistributor = lead.interest === "distribution";
  const dbId = isDistributor
    ? process.env.NOTION_DISTRIBUTOR_PROSPECTS_DB
    : process.env.NOTION_B2B_PROSPECTS_DB;

  if (!notionKey || !dbId) {
    console.warn("[leads] Notion B2B pipeline not configured, skipping.");
    return;
  }

  const interestLabel = INTEREST_LABELS[lead.interest] || lead.interest;
  const notesLines = [
    `Submitted via wholesale page`,
    lead.interest ? `Interest: ${interestLabel}` : "",
    lead.location ? `Location: ${lead.location}` : "",
    lead.buyerName ? `Contact: ${lead.buyerName}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Build Notion properties — field names vary between databases, so we
  // use the same patterns the pipeline route's parseLead() looks for.
  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: lead.storeName || lead.buyerName || lead.email } }] },
    Email: { email: lead.email },
    Status: { select: { name: "Lead" } },
    Source: { rich_text: [{ text: { content: lead.source || "wholesale-page" } }] },
    Notes: { rich_text: [{ text: { content: notesLines } }] },
  };

  // Add optional fields if the DB supports them
  if (lead.buyerName) {
    properties["Contact Name"] = {
      rich_text: [{ text: { content: lead.buyerName } }],
    };
  }
  if (lead.location) {
    properties["Location"] = {
      rich_text: [{ text: { content: lead.location } }],
    };
  }

  try {
    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionKey}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: dbId },
        properties,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error("[leads] Notion create failed:", res.status, err);
    } else {
      console.info("[leads] Added to B2B pipeline:", lead.email, isDistributor ? "(distributor)" : "(b2b)");
    }
  } catch (err) {
    console.error("[leads] Notion create error:", err);
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  let body: LeadPayload;
  try {
    body = (await req.json()) as LeadPayload;
  } catch {
    body = {};
  }

  const email = String(body.email || "").trim();
  const phone = String(body.phone || "").trim();
  const source = String(body.source || "unknown");
  const intent = String(body.intent || "newsletter");
  const storeName = String(body.storeName || "").trim();
  const buyerName = String(body.buyerName || "").trim();
  const location = String(body.location || "").trim();
  const interest = String(body.interest || "").trim();

  if (!email && !phone) {
    return json({ ok: false, error: "Missing email or phone." }, 400);
  }

  console.info("Lead capture", {
    email,
    phone,
    source,
    intent,
    storeName,
    buyerName,
    location,
    interest,
  });

  // Fire webhook (existing flow)
  const webhookUrl = process.env.LEADS_WEBHOOK_URL;
  if (webhookUrl) {
    const auth = process.env.LEADS_WEBHOOK_AUTH;
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: auth } : {}),
        },
        body: JSON.stringify({
          email,
          phone,
          source,
          intent,
          storeName,
          buyerName,
          location,
          interest,
          timestamp: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        console.warn("[leads] Webhook failed:", res.status);
      }
    } catch (err) {
      console.warn("[leads] Webhook error:", err);
    }
  }

  // Add wholesale leads to the Notion B2B pipeline
  if (intent === "wholesale" && email) {
    // Fire-and-forget — don't block the response on Notion write
    addToB2BPipeline({ email, buyerName, storeName, location, interest, source }).catch(() => {});
  }

  return json({ ok: true });
}
