/**
 * Research Librarian runtime.
 *
 * Contract: /contracts/agents/research-librarian.md.
 *
 * Friday 10:00 PT (17:00 UTC) cron. One job: compose the weekly
 * synthesis digest across R-1..R-7 and post to `#research`.
 *
 * Two-mode design:
 *   - If KV `research:notes` has entries in the last 7 days, group
 *     by code and render a per-stream summary with citations.
 *   - If none, render a "research prompts" digest — one per stream —
 *     as open-ended questions for Claude Code / Ben / Rene to work
 *     against during the coming week. Each prompt maps to a research
 *     stream's canonical focus (see lib/ops/research-notes.ts).
 *
 * Findings flow in via POST /api/ops/research/note any time; the
 * librarian is the weekly rollup.
 *
 * Every note citation surfaces `capturedAt` + `capturedBy` +
 * `sources[]`. No fabrication — if a stream has nothing, it says so.
 *
 * Auth: bearer CRON_SECRET (isAuthorized + middleware whitelist).
 */

import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getChannel, slackChannelRef } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import {
  listResearchNotes,
  RESEARCH_CODES,
  RESEARCH_PROMPTS,
  type ResearchCode,
  type ResearchNote,
} from "@/lib/ops/research-notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_ID = process.env.AGENT_ID_RESEARCH_LIBRARIAN ?? "research-librarian";

export async function GET(req: Request): Promise<Response> {
  return runAgent(req);
}

export async function POST(req: Request): Promise<Response> {
  return runAgent(req);
}

async function runAgent(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const shouldPost = url.searchParams.get("post") !== "false";
  const daysBack = Number.parseInt(url.searchParams.get("days") ?? "7", 10);

  const run = newRunContext({
    agentId: AGENT_ID,
    division: "research-intelligence",
    source: "scheduled",
    trigger: "friday-10:00PT-synthesis",
  });

  const notes = await listResearchNotes(Number.isFinite(daysBack) ? daysBack : 7);
  const byCode: Record<ResearchCode, ResearchNote[]> = {
    "R-1": [],
    "R-2": [],
    "R-3": [],
    "R-4": [],
    "R-5": [],
    "R-6": [],
    "R-7": [],
  };
  for (const note of notes) byCode[note.code].push(note);

  const anyContent = notes.length > 0;
  const rendered = anyContent ? renderSynthesis(byCode, notes.length) : renderPrompts();

  let postedTo: string | null = null;
  const degraded: string[] = [];
  if (shouldPost) {
    const channel = getChannel("research");
    if (channel) {
      try {
        const res = await postMessage({ channel: slackChannelRef("research"), text: rendered });
        if (res.ok) postedTo = channel.name;
      } catch (err) {
        degraded.push(
          `slack-post: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      degraded.push("slack-post: #research channel not registered");
    }
  }

  try {
    await auditStore().append(
      buildAuditEntry(run, {
        action: "slack.post.audit",
        entityType: "research-librarian-synthesis",
        entityId: run.runId,
        result: "ok",
        sourceCitations: [{ system: "kv:research:notes" }],
        confidence: 1,
      }),
    );
  } catch {
    degraded.push("audit-store: append failed (soft)");
  }

  return NextResponse.json({
    ok: true,
    runId: run.runId,
    mode: anyContent ? "synthesis" : "prompts",
    noteCount: notes.length,
    byCode: Object.fromEntries(
      Object.entries(byCode).map(([code, list]) => [code, list.length]),
    ),
    rendered,
    postedTo,
    degraded,
  });
}

// ---- Rendering ---------------------------------------------------------

function renderSynthesis(
  byCode: Record<ResearchCode, ResearchNote[]>,
  total: number,
): string {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const lines: string[] = [
    `📚 *Research Librarian — Weekly Synthesis (${today})*`,
    ``,
    `${total} notes across R-1..R-7 in the last 7 days.`,
    ``,
  ];

  for (const code of RESEARCH_CODES) {
    const list = byCode[code];
    const prompt = RESEARCH_PROMPTS[code];
    if (list.length === 0) {
      lines.push(
        `*${code} · ${prompt.title}* — _no notes captured this week._`,
      );
      continue;
    }
    lines.push(`*${code} · ${prompt.title}* (${list.length} note${list.length === 1 ? "" : "s"}):`);
    const top = list.slice(0, 4);
    for (const n of top) {
      const confidencePct = Math.round(n.confidence * 100);
      const srcText = n.sources.length > 0 ? ` — sources: ${n.sources.slice(0, 3).join(" · ")}` : "";
      lines.push(
        `  • *${n.title}* (conf ${confidencePct}%, ${n.capturedBy}) — ${n.summary.slice(0, 220)}${srcText}`,
      );
    }
    if (list.length > top.length) {
      lines.push(`  _+ ${list.length - top.length} more — full list via GET /api/ops/research/note._`);
    }
    lines.push(``);
  }

  lines.push(
    `_Source: kv:research:notes · Librarian synthesized ${total} notes. Submit more via POST /api/ops/research/note {code, title, summary}._`,
  );
  return lines.join("\n");
}

function renderPrompts(): string {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const lines: string[] = [
    `📚 *Research Librarian — Open Research Prompts (${today})*`,
    ``,
    `Nothing in the Open Brain queue this week. Here are this week's research streams — answer any/all inline or via POST /api/ops/research/note:`,
    ``,
  ];
  for (const code of RESEARCH_CODES) {
    const { title, prompt } = RESEARCH_PROMPTS[code];
    lines.push(`*${code} · ${title}*`);
    lines.push(`  ${prompt}`);
    lines.push(``);
  }
  lines.push(
    `_Drop findings: \`POST /api/ops/research/note { code: "R-3", title: "...", summary: "...", sources: ["..."] }\` with bearer CRON_SECRET. Next synthesis fires Friday 10 AM PT._`,
  );
  return lines.join("\n");
}
