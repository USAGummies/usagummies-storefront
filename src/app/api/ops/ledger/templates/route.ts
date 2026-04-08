import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { listTemplates, getTemplate, upsertTemplate } from "@/lib/ops/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(req.url);
    const name = url.searchParams.get("name");
    if (name) {
      const template = await getTemplate(name);
      if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
      return NextResponse.json({ ok: true, template });
    }
    const templates = await listTemplates();
    return NextResponse.json({ ok: true, templates, count: templates.length });
  } catch (error) {
    return NextResponse.json({ error: "Failed to list templates" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    if (!body.id || !body.name || !body.format_spec || !body.created_by) {
      return NextResponse.json({ error: "Required: id, name, format_spec, created_by" }, { status: 400 });
    }
    const template = await upsertTemplate({
      id: body.id, name: body.name, description: body.description || "",
      format_spec: body.format_spec, created_by: body.created_by,
      reference_url: body.reference_url,
    });
    return NextResponse.json({ ok: true, template });
  } catch (error) {
    return NextResponse.json({ error: "Failed to save template" }, { status: 500 });
  }
}
