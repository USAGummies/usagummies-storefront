/**
 * POST /api/ops/abra/execute-command — Execute an approved command (called by SMS handler)
 * Body: { commandId: string }
 * Auth: CRON_SECRET bearer token
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || token !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { commandId } = (await req.json()) as { commandId?: string };
  if (!commandId) {
    return NextResponse.json(
      { error: "Missing commandId" },
      { status: 400 },
    );
  }

  const sbUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!sbUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 500 },
    );
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  // Fetch command
  const cmdRes = await fetch(
    `${sbUrl}/rest/v1/abra_email_commands?id=eq.${encodeURIComponent(commandId)}&select=*&limit=1`,
    { headers, signal: AbortSignal.timeout(10000) },
  );

  if (!cmdRes.ok) {
    return NextResponse.json(
      { error: "Failed to fetch command" },
      { status: 500 },
    );
  }

  const cmds = await cmdRes.json();
  if (cmds.length === 0) {
    return NextResponse.json(
      { error: "Command not found" },
      { status: 404 },
    );
  }

  const cmd = cmds[0];

  // For now, just return status — the full execution with tool_use will be handled
  // by the main execution engine once it's refactored into a shared function
  return NextResponse.json({
    ok: true,
    message: `Command ${commandId} status: ${cmd.status}`,
    command: { id: cmd.id, status: cmd.status, task: cmd.task },
  });
}
