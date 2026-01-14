import { NextResponse } from "next/server";

type LeadPayload = {
  email?: string;
  phone?: string;
  source?: string;
  intent?: string;
};

function json(data: any, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

  if (!email && !phone) {
    return json({ ok: false, error: "Missing email or phone." }, 400);
  }

  console.info("Lead capture", { email, phone, source, intent });

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
          timestamp: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        return json({ ok: false, error: "Lead capture unavailable." }, 502);
      }
    } catch {
      return json({ ok: false, error: "Lead capture unavailable." }, 502);
    }
  }

  return json({ ok: true });
}
