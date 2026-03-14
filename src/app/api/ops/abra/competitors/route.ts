import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@/lib/auth/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_TYPES = new Set([
  "pricing",
  "product",
  "promotion",
  "review",
  "market_position",
]);

type CompetitorInput = {
  competitor_name?: unknown;
  data_type?: unknown;
  title?: unknown;
  detail?: unknown;
  source?: unknown;
  source_url?: unknown;
  metadata?: unknown;
  department?: unknown;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Supabase environment is not configured");
  }
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

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

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildCompetitorDedupeKey(params: {
  competitorName: string;
  dataType: string;
  title: string;
  detail: string;
}): string {
  const canonical = [
    params.competitorName.toLowerCase(),
    params.dataType.toLowerCase(),
    params.title.toLowerCase(),
    params.detail.toLowerCase(),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const competitor = asText(url.searchParams.get("competitor"));
    const dataType = asText(url.searchParams.get("data_type"));
    const limitRaw = Number(url.searchParams.get("limit") || 50);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.floor(limitRaw), 1), 200)
      : 50;

    if (dataType && !DATA_TYPES.has(dataType)) {
      return NextResponse.json(
        { error: "Invalid data_type" },
        { status: 400 },
      );
    }

    const params = new URLSearchParams({
      select:
        "id,competitor_name,data_type,title,detail,source,source_url,metadata,department,created_at,created_by",
      order: "created_at.desc",
      limit: String(limit),
    });

    if (competitor) {
      // Strip PostgREST special chars and encode for safe ilike pattern
      const cleaned = competitor.replace(/[*%().,]/g, "").slice(0, 200);
      if (cleaned) {
        params.set("competitor_name", `ilike.*${encodeURIComponent(cleaned)}*`);
      }
    }
    if (dataType) {
      params.set("data_type", `eq.${dataType}`);
    }

    const rows = await sbFetch(`/rest/v1/abra_competitor_intel?${params.toString()}`);
    return NextResponse.json({
      entries: Array.isArray(rows) ? rows : [],
      count: Array.isArray(rows) ? rows.length : 0,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch competitor intelligence" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CompetitorInput = {};
  try {
    body = (await req.json()) as CompetitorInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const competitorName = asText(body.competitor_name).slice(0, 200);
  const dataType = asText(body.data_type).slice(0, 50);
  const title = asText(body.title).slice(0, 500);
  const detail = asText(body.detail).slice(0, 5000);
  const source = (asText(body.source) || "manual").slice(0, 200);
  const sourceUrl = asText(body.source_url).slice(0, 2000);
  const department = (asText(body.department) || "sales_and_growth").slice(0, 50);

  if (!competitorName || !dataType || !title) {
    return NextResponse.json(
      { error: "competitor_name, data_type, and title are required" },
      { status: 400 },
    );
  }
  if (!DATA_TYPES.has(dataType)) {
    return NextResponse.json({ error: "Invalid data_type" }, { status: 400 });
  }

  const metadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? body.metadata
      : {};

  try {
    const dedupeKey = buildCompetitorDedupeKey({
      competitorName,
      dataType,
      title,
      detail,
    });
    const inserted = (await sbFetch(
      "/rest/v1/abra_competitor_intel?on_conflict=dedupe_key",
      {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        competitor_name: competitorName,
        data_type: dataType,
        title,
        detail: detail || null,
        source,
        source_url: sourceUrl || null,
        metadata,
        dedupe_key: dedupeKey,
        department,
        created_by: session.user.email,
      }),
    })) as Array<Record<string, unknown>>;

    return NextResponse.json(
      { entry: Array.isArray(inserted) ? inserted[0] || null : null },
      { status: 201 },
    );
  } catch {
    // Fallback insert path for environments without dedupe migration applied yet.
    try {
      const inserted = (await sbFetch("/rest/v1/abra_competitor_intel", {
        method: "POST",
        headers: {
          Prefer: "return=representation",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          competitor_name: competitorName,
          data_type: dataType,
          title,
          detail: detail || null,
          source,
          source_url: sourceUrl || null,
          metadata,
          department,
          created_by: session.user.email,
        }),
      })) as Array<Record<string, unknown>>;

      return NextResponse.json(
        { entry: Array.isArray(inserted) ? inserted[0] || null : null },
        { status: 201 },
      );
    } catch (fallbackError) {
      return NextResponse.json(
        {
          error:
            fallbackError instanceof Error
              ? fallbackError.message
              : "Failed to create competitor intel entry",
        },
        { status: 500 },
      );
    }
  }
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CompetitorInput & { id?: unknown } = {};
  try {
    body = (await req.json()) as CompetitorInput & { id?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const id = asText(body.id);
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }

  const payload: Record<string, unknown> = {};
  const competitorName = asText(body.competitor_name).slice(0, 200);
  const dataType = asText(body.data_type).slice(0, 50);
  const title = asText(body.title).slice(0, 500);
  const detail = asText(body.detail).slice(0, 5000);
  const source = asText(body.source).slice(0, 200);
  const sourceUrl = asText(body.source_url).slice(0, 2000);
  const department = asText(body.department).slice(0, 50);

  if (competitorName) payload.competitor_name = competitorName;
  if (dataType) {
    if (!DATA_TYPES.has(dataType)) {
      return NextResponse.json({ error: "Invalid data_type" }, { status: 400 });
    }
    payload.data_type = dataType;
  }
  if (title) payload.title = title;
  if (typeof body.detail === "string") payload.detail = detail || null;
  if (source) payload.source = source;
  if (typeof body.source_url === "string") payload.source_url = sourceUrl || null;
  if (department) payload.department = department;
  if (body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)) {
    payload.metadata = body.metadata;
  }
  payload.created_by = session.user.email;

  try {
    const updated = (await sbFetch(`/rest/v1/abra_competitor_intel?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })) as Array<Record<string, unknown>>;

    return NextResponse.json({ entry: Array.isArray(updated) ? updated[0] || null : null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update competitor intel entry" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let id = "";
  try {
    const url = new URL(req.url);
    id = asText(url.searchParams.get("id"));
    if (!id) {
      const body = (await req.json().catch(() => ({}))) as { id?: unknown };
      id = asText(body.id);
    }
  } catch {
    // Ignore, validated below.
  }

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const UUID_RE_DEL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE_DEL.test(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }

  try {
    await sbFetch(`/rest/v1/abra_competitor_intel?id=eq.${id}`, {
      method: "DELETE",
      headers: {
        Prefer: "return=minimal",
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete competitor intel entry" },
      { status: 500 },
    );
  }
}
