import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SignalRow = {
  id: string;
  signal_type: string | null;
  severity: "info" | "warning" | "critical" | null;
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
    signal: init.signal || AbortSignal.timeout(15000),
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
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const rows = (await sbFetch(
      `/rest/v1/abra_operational_signals?source=eq.email&created_at=gte.${encodeURIComponent(since)}&select=id,signal_type,severity,created_at&order=created_at.desc&limit=1000`,
    )) as SignalRow[];

    const grouped = new Map<
      string,
      { signal_type: string; count: number; critical: number; warning: number; info: number }
    >();

    for (const row of rows) {
      const key = row.signal_type || "unknown";
      const existing = grouped.get(key) || {
        signal_type: key,
        count: 0,
        critical: 0,
        warning: 0,
        info: 0,
      };
      existing.count += 1;
      if (row.severity === "critical") existing.critical += 1;
      else if (row.severity === "warning") existing.warning += 1;
      else existing.info += 1;
      grouped.set(key, existing);
    }

    const by_type = Array.from(grouped.values()).sort((a, b) => b.count - a.count);
    return NextResponse.json({
      total: rows.length,
      since,
      by_type,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load email signals",
      },
      { status: 500 },
    );
  }
}
