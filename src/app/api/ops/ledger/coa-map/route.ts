import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { getCoaMap, setCoaMap, upsertChannelRouting } from "@/lib/ops/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const map = await getCoaMap();
    return NextResponse.json({ ok: true, routing_table: map, channels: map.length });
  } catch (error) {
    console.error("[ledger/coa-map] GET failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to get COA map" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    // Bulk set: { routes: [...] }
    if (body.routes && Array.isArray(body.routes)) {
      for (const r of body.routes) {
        if (!r.channel || !r.revenue_acct || !r.cogs_acct || !r.freight_acct) {
          return NextResponse.json(
            { error: "Each route needs: channel, revenue_acct, cogs_acct, freight_acct" },
            { status: 400 }
          );
        }
      }
      const map = await setCoaMap(body.routes);
      return NextResponse.json({ ok: true, routing_table: map, channels: map.length });
    }

    // Single upsert: { channel, revenue_acct, cogs_acct, freight_acct }
    if (!body.channel || !body.revenue_acct || !body.cogs_acct || !body.freight_acct) {
      return NextResponse.json(
        { error: "Required: channel, revenue_acct, cogs_acct, freight_acct (or routes[] for bulk)" },
        { status: 400 }
      );
    }

    const map = await upsertChannelRouting({
      channel: body.channel,
      revenue_acct: body.revenue_acct,
      cogs_acct: body.cogs_acct,
      freight_acct: body.freight_acct,
      notes: body.notes,
    });

    return NextResponse.json({ ok: true, routing_table: map, channels: map.length });
  } catch (error) {
    console.error("[ledger/coa-map] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to update COA map" }, { status: 500 });
  }
}
