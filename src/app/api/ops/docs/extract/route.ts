import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { extractDocument, listExtractedDocs } from "@/lib/ops/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(req.url);
    const vendor = url.searchParams.get("vendor") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "100");
    const docs = await listExtractedDocs({ vendor, limit });
    return NextResponse.json({ ok: true, documents: docs, count: docs.length });
  } catch (error) {
    return NextResponse.json({ error: "Failed to list documents" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    if (!body.source_url || !body.source_type) {
      return NextResponse.json({ error: "Required: source_url, source_type (gmail|slack|upload)" }, { status: 400 });
    }
    const doc = await extractDocument({
      source_url: body.source_url, source_type: body.source_type,
      doc_type: body.doc_type, vendor_hint: body.vendor_hint,
    });
    return NextResponse.json({ ok: true, document: doc });
  } catch (error) {
    return NextResponse.json({ error: "Failed to extract document" }, { status: 500 });
  }
}
