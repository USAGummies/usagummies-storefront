import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body?.type === "url_verification") {
      return NextResponse.json({ challenge: body.challenge || "" });
    }
  } catch {}
  return NextResponse.json({ ok: true });
}
