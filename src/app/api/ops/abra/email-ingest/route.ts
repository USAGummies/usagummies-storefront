import { NextResponse } from "next/server";
import {
  emitSignal,
  extractEmailSignals,
} from "@/lib/ops/abra-operational-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type EmailEventRow = {
  id: string;
  sender_email: string | null;
  sender_name: string | null;
  subject: string | null;
  raw_text: string | null;
  category: string | null;
  user_action: string | null;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}) {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  headers.set("Content-Type", "application/json");

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(20000),
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!res.ok) {
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }

  return json;
}

function mapCategoryToDepartment(category: string | null): string | undefined {
  switch ((category || "").toLowerCase()) {
    case "finance":
      return "finance";
    case "sales":
    case "retail":
    case "marketplace":
    case "customer":
      return "sales_and_growth";
    case "production":
    case "regulatory":
    case "compliance":
      return "operations";
    default:
      return undefined;
  }
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const rows = (await sbFetch(
      `/rest/v1/email_events?received_at=gte.${encodeURIComponent(sinceIso)}&select=id,sender_email,sender_name,subject,raw_text,category,user_action&order=received_at.desc&limit=500`,
    )) as EmailEventRow[];

    let emailsProcessed = 0;
    let signalsEmitted = 0;

    for (const row of rows) {
      if (row.user_action === "signal_processed") continue;

      const from = row.sender_email || row.sender_name || "unknown";
      const subject = row.subject || "(no subject)";
      const body = row.raw_text || "";
      const department = mapCategoryToDepartment(row.category);

      const signals = extractEmailSignals({
        from,
        subject,
        body,
        department,
      });

      for (const signal of signals) {
        const id = await emitSignal(signal);
        if (id) signalsEmitted += 1;
      }

      await sbFetch(`/rest/v1/email_events?id=eq.${row.id}`, {
        method: "PATCH",
        headers: {
          Prefer: "return=minimal",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_action: "signal_processed",
          user_action_at: new Date().toISOString(),
        }),
      });

      emailsProcessed += 1;
    }

    return NextResponse.json({
      emails_processed: emailsProcessed,
      signals_emitted: signalsEmitted,
      scanned: rows.length,
      since: sinceIso,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Email signal ingest failed",
      },
      { status: 500 },
    );
  }
}
