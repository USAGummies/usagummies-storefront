import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { buildCatalogCsv, getApPacket, listApPackets } from "@/lib/ops/ap-packets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("account")?.trim();
  const format = searchParams.get("format")?.trim();

  if (!slug) {
    return NextResponse.json({
      ok: true,
      packets: listApPackets().map((packet) => ({
        slug: packet.slug,
        accountName: packet.accountName,
        apEmail: packet.apEmail,
        owner: packet.owner,
        status: packet.status,
        dueWindow: packet.dueWindow,
        pricingNeedsReview: packet.pricingNeedsReview,
      })),
    });
  }

  const packet = getApPacket(slug);
  if (!packet) {
    return NextResponse.json({ error: "Packet not found" }, { status: 404 });
  }

  if (format === "csv") {
    return new Response(buildCatalogCsv(packet), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${packet.slug}-item-list.csv"`,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    packet,
  });
}
