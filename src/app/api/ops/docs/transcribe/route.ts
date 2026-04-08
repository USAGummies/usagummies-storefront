import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { transcribeAudio, listTranscripts } from "@/lib/ops/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(req.url);
    const source_channel = url.searchParams.get("source_channel") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const transcripts = await listTranscripts({ source_channel, limit });
    return NextResponse.json({ ok: true, transcripts, count: transcripts.length });
  } catch (error) {
    return NextResponse.json({ error: "Failed to list transcripts" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    if (!body.source_url) {
      return NextResponse.json({ error: "Required: source_url" }, { status: 400 });
    }
    const transcript = await transcribeAudio({
      source_url: body.source_url, source_channel: body.source_channel,
      source_user: body.source_user, speaker: body.speaker, topic: body.topic,
    });
    return NextResponse.json({ ok: true, transcript });
  } catch (error) {
    return NextResponse.json({ error: "Failed to transcribe" }, { status: 500 });
  }
}
