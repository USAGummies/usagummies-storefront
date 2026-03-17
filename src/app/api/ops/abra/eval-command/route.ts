/**
 * POST /api/ops/abra/eval-command — Auto-evaluate a completed email command
 *
 * Body: { commandId: string }
 * Auth: CRON_SECRET bearer token
 *
 * Uses a separate LLM call to score the execution quality across dimensions.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function sanitize(text: string, maxLen = 1000): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").slice(0, maxLen);
}

function sbHeaders() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

function sbUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
}

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || token !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { commandId } = (await req.json()) as { commandId?: string };
  if (!commandId) {
    return NextResponse.json({ error: "Missing commandId" }, { status: 400 });
  }

  // Fetch the completed command
  const cmdRes = await fetch(
    `${sbUrl()}/rest/v1/abra_email_commands?id=eq.${encodeURIComponent(commandId)}&select=*&limit=1`,
    { headers: sbHeaders(), signal: AbortSignal.timeout(10000) },
  );
  if (!cmdRes.ok) {
    return NextResponse.json({ error: "Failed to fetch command" }, { status: 500 });
  }
  const cmds = await cmdRes.json();
  if (cmds.length === 0) {
    return NextResponse.json({ error: "Command not found" }, { status: 404 });
  }
  const cmd = cmds[0];

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json({ error: "No ANTHROPIC_API_KEY" }, { status: 500 });
  }

  try {
    const evalRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: `You are an AI quality evaluator. Score the execution of an email command processed by "Abra" (an AI assistant for USA Gummies).

Score each dimension from 0.0 to 1.0:
- task_understanding: Did Abra correctly interpret what was requested?
- execution_quality: Were appropriate actions taken? Were tools used correctly?
- reply_quality: Was the draft reply professional, accurate, and helpful?

Respond in JSON:
{
  "task_understanding": 0.0-1.0,
  "execution_quality": 0.0-1.0,
  "reply_quality": 0.0-1.0,
  "overall_score": 0.0-1.0,
  "reasoning": "1-2 sentences explaining the scores"
}

IMPORTANT: Respond ONLY with valid JSON.`,
        messages: [{
          role: "user",
          content: `ORIGINAL REQUEST:
From: ${sanitize(cmd.sender_name || "")} (${sanitize(cmd.sender_email || "")})
Subject: ${sanitize(cmd.subject || "")}
Task: ${sanitize(cmd.task || "")}
Context: ${sanitize((cmd.body_snippet || "").slice(0, 500))}

EXECUTION RESULT:
Summary: ${sanitize((cmd.execution_summary || cmd.result_text || "(none)").slice(0, 500))}
Status: ${cmd.status}

DRAFT REPLY:
Subject: ${sanitize(cmd.draft_reply_subject || "(none)")}
Body: ${sanitize((cmd.draft_reply_body || "").slice(0, 500))}`,
        }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!evalRes.ok) {
      return NextResponse.json({ error: `Eval LLM failed: ${evalRes.status}` }, { status: 500 });
    }

    const evalData = await evalRes.json();
    const raw = evalData.content?.[0]?.text || "";

    let scores: {
      task_understanding: number;
      execution_quality: number;
      reply_quality: number;
      overall_score: number;
      reasoning: string;
    };

    try {
      scores = JSON.parse(raw.trim());
    } catch {
      return NextResponse.json({ error: "Failed to parse eval response" }, { status: 500 });
    }

    // Clamp all scores to [0.0, 1.0]
    const clamp01 = (v: unknown): number => {
      const n = typeof v === "number" ? v : parseFloat(String(v));
      if (isNaN(n)) return 0;
      return Math.max(0, Math.min(1, n));
    };
    scores.task_understanding = clamp01(scores.task_understanding);
    scores.execution_quality = clamp01(scores.execution_quality);
    scores.reply_quality = clamp01(scores.reply_quality);
    scores.overall_score = clamp01(scores.overall_score);

    // Store eval
    await fetch(`${sbUrl()}/rest/v1/abra_command_evals`, {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify({
        command_id: commandId,
        task_understanding: scores.task_understanding,
        execution_quality: scores.execution_quality,
        reply_quality: scores.reply_quality,
        overall_score: scores.overall_score,
        auto_eval_reasoning: scores.reasoning,
        model_used: cmd.model_used || "claude-sonnet-4-6",
      }),
      signal: AbortSignal.timeout(10000),
    });

    return NextResponse.json({ ok: true, scores });
  } catch (err) {
    return NextResponse.json({
      error: `Eval failed: ${err instanceof Error ? err.message : "Unknown"}`,
    }, { status: 500 });
  }
}
