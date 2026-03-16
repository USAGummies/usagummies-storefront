/**
 * POST /api/ops/abra/evolve-prompt — Analyze evals and generate improved prompt
 * Auth: CRON_SECRET bearer token
 *
 * Workflow:
 * 1. Fetch last N evals with scores
 * 2. Identify weak dimensions
 * 3. Ask LLM to generate improved system prompt
 * 4. Store as new prompt version (inactive until manually activated)
 * 5. Notify via Slack
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json({ error: "No ANTHROPIC_API_KEY" }, { status: 500 });
  }

  try {
    // Fetch recent evals
    const evalsRes = await fetch(
      `${sbUrl()}/rest/v1/abra_command_evals?order=created_at.desc&limit=50&select=*`,
      { headers: sbHeaders(), signal: AbortSignal.timeout(10000) },
    );
    if (!evalsRes.ok) {
      return NextResponse.json({ error: "Failed to fetch evals" }, { status: 500 });
    }
    const evals = await evalsRes.json();

    if (evals.length < 5) {
      return NextResponse.json({ ok: false, message: "Need at least 5 evals to evolve prompt" });
    }

    // Calculate averages
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const taskScores = evals.filter((e: Record<string, unknown>) => e.task_understanding != null).map((e: Record<string, unknown>) => e.task_understanding as number);
    const execScores = evals.filter((e: Record<string, unknown>) => e.execution_quality != null).map((e: Record<string, unknown>) => e.execution_quality as number);
    const replyScores = evals.filter((e: Record<string, unknown>) => e.reply_quality != null).map((e: Record<string, unknown>) => e.reply_quality as number);
    const overallScores = evals.filter((e: Record<string, unknown>) => e.overall_score != null).map((e: Record<string, unknown>) => e.overall_score as number);

    const stats = {
      task_understanding: taskScores.length > 0 ? avg(taskScores) : 0,
      execution_quality: execScores.length > 0 ? avg(execScores) : 0,
      reply_quality: replyScores.length > 0 ? avg(replyScores) : 0,
      overall: overallScores.length > 0 ? avg(overallScores) : 0,
      count: evals.length,
    };

    // Identify weak areas
    const weakAreas: string[] = [];
    if (stats.task_understanding < 0.8) weakAreas.push(`task understanding (${(stats.task_understanding * 100).toFixed(0)}%)`);
    if (stats.execution_quality < 0.8) weakAreas.push(`execution quality (${(stats.execution_quality * 100).toFixed(0)}%)`);
    if (stats.reply_quality < 0.8) weakAreas.push(`reply quality (${(stats.reply_quality * 100).toFixed(0)}%)`);

    // Get current active prompt
    const promptRes = await fetch(
      `${sbUrl()}/rest/v1/abra_prompt_versions?prompt_type=eq.email_command&active=eq.true&limit=1&select=*`,
      { headers: sbHeaders(), signal: AbortSignal.timeout(10000) },
    );
    const currentPrompts = await promptRes.json();
    const currentPrompt = currentPrompts[0]?.system_prompt || "(no active prompt — using hardcoded default)";

    // Get human feedback
    const feedbackEntries = evals
      .filter((e: Record<string, unknown>) => e.human_feedback)
      .map((e: Record<string, unknown>) => e.human_feedback as string)
      .slice(0, 10);

    // Ask LLM to generate improved prompt
    const evolveRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: 4096,
        system: `You are a prompt engineer improving the system prompt for "Abra", an AI operations assistant that processes email commands for USA Gummies (a CPG candy company).

Given evaluation scores, weak areas, and human feedback, generate an improved system prompt that addresses the weaknesses while maintaining strengths.

Respond in JSON:
{
  "improved_prompt": "The full improved system prompt",
  "changes": ["List of specific changes made"],
  "expected_improvement": "Which scores should improve and why"
}`,
        messages: [{
          role: "user",
          content: `CURRENT PERFORMANCE (${stats.count} evals):
- Task Understanding: ${(stats.task_understanding * 100).toFixed(0)}%
- Execution Quality: ${(stats.execution_quality * 100).toFixed(0)}%
- Reply Quality: ${(stats.reply_quality * 100).toFixed(0)}%
- Overall: ${(stats.overall * 100).toFixed(0)}%

WEAK AREAS: ${weakAreas.length > 0 ? weakAreas.join(", ") : "None identified"}

HUMAN FEEDBACK:
${feedbackEntries.length > 0 ? feedbackEntries.join("\n") : "(no human feedback yet)"}

CURRENT SYSTEM PROMPT:
${currentPrompt}

Generate an improved version that addresses the weak areas.`,
        }],
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!evolveRes.ok) {
      return NextResponse.json({ error: `Evolution LLM failed: ${evolveRes.status}` }, { status: 500 });
    }

    const evolveData = await evolveRes.json();
    const evolveRaw = evolveData.content?.[0]?.text || "";

    let evolution: { improved_prompt: string; changes: string[]; expected_improvement: string };
    try {
      evolution = JSON.parse(evolveRaw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    } catch {
      return NextResponse.json({ error: "Failed to parse evolution response" }, { status: 500 });
    }

    // Get next version number
    const versionsRes = await fetch(
      `${sbUrl()}/rest/v1/abra_prompt_versions?prompt_type=eq.email_command&order=version.desc&limit=1&select=version`,
      { headers: sbHeaders(), signal: AbortSignal.timeout(10000) },
    );
    const versions = await versionsRes.json();
    const nextVersion = (versions[0]?.version || 0) + 1;

    // Store new prompt version (inactive — needs manual activation)
    await fetch(`${sbUrl()}/rest/v1/abra_prompt_versions`, {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify({
        prompt_type: "email_command",
        version: nextVersion,
        system_prompt: evolution.improved_prompt,
        avg_score: stats.overall,
        eval_count: stats.count,
        active: false,
        notes: `Changes: ${evolution.changes.join("; ")}. Expected: ${evolution.expected_improvement}`,
      }),
      signal: AbortSignal.timeout(10000),
    });

    // Notify Slack
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (botToken) {
      const slackText = `\u{1f9ec} *Prompt Evolution v${nextVersion} Generated*\n` +
        `*Current scores:* Task ${(stats.task_understanding * 100).toFixed(0)}% | Exec ${(stats.execution_quality * 100).toFixed(0)}% | Reply ${(stats.reply_quality * 100).toFixed(0)}%\n` +
        `*Weak areas:* ${weakAreas.length > 0 ? weakAreas.join(", ") : "None"}\n` +
        `*Changes:* ${evolution.changes.slice(0, 3).join("; ")}\n\n` +
        `_Use \`/abra activate-prompt v${nextVersion}\` to activate_`;

      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel: "C0ALS6W7VB4", text: slackText, mrkdwn: true }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      version: nextVersion,
      stats,
      changes: evolution.changes,
    });
  } catch (err) {
    return NextResponse.json({
      error: `Evolution failed: ${err instanceof Error ? err.message : "Unknown"}`,
    }, { status: 500 });
  }
}
