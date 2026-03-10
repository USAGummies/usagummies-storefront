import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import { sendMonthlyReport, sendWeeklyDigest } from "@/lib/ops/abra-weekly-digest";
import { notify } from "@/lib/ops/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DigestRow = {
  id: string;
  title: string;
  raw_text: string;
  summary_text: string | null;
  created_at: string;
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
    signal: init.signal || AbortSignal.timeout(12000),
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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${typeof json === "string" ? json : JSON.stringify(json)}`,
    );
  }

  return json;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = (await sbFetch(
      "/rest/v1/open_brain_entries?source_ref=eq.weekly-digest&category=eq.report&select=id,title,raw_text,summary_text,created_at&order=created_at.desc&limit=1",
    )) as DigestRow[];

    return NextResponse.json({ digest: rows[0] || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load weekly digest";
    console.error("[abra-digest] GET failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const type = (new URL(req.url).searchParams.get("type") || "weekly").toLowerCase();

  try {
    if (type === "weekly") {
      await sendWeeklyDigest();
      return NextResponse.json({ success: true, type });
    }

    if (type === "monthly") {
      await sendMonthlyReport();
      return NextResponse.json({ success: true, type });
    }

    return NextResponse.json({ error: "Invalid type. Use weekly or monthly." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run digest";
    console.error("[abra-digest] POST failed:", message);
    void notify({
      channel: "alerts",
      text: `🚨 Digest generation failed (${type}): ${message}`,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
