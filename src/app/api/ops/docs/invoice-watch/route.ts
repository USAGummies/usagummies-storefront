import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { listInvoiceWatchRules, upsertInvoiceWatchRule, matchInvoiceRule } from "@/lib/ops/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(req.url);
    const matchEmail = url.searchParams.get("match");
    if (matchEmail) {
      const rule = await matchInvoiceRule(matchEmail);
      return NextResponse.json({ ok: true, matched: !!rule, rule });
    }
    const rules = await listInvoiceWatchRules();
    return NextResponse.json({ ok: true, rules, count: rules.length });
  } catch (error) {
    return NextResponse.json({ error: "Failed to list invoice watch rules" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    if (!body.id || !body.vendor_name || !body.vendor_email_patterns) {
      return NextResponse.json({ error: "Required: id, vendor_name, vendor_email_patterns[]" }, { status: 400 });
    }
    const rules = await upsertInvoiceWatchRule({
      id: body.id, vendor_name: body.vendor_name,
      vendor_email_patterns: body.vendor_email_patterns,
      auto_extract: body.auto_extract ?? true,
      auto_stage_entry: body.auto_stage_entry ?? false,
      default_category: body.default_category,
      default_debit_account: body.default_debit_account,
      default_credit_account: body.default_credit_account,
      notes: body.notes,
    });
    return NextResponse.json({ ok: true, rules, count: rules.length });
  } catch (error) {
    return NextResponse.json({ error: "Failed to save invoice watch rule" }, { status: 500 });
  }
}
