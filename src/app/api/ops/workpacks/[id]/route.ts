import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  getWorkpack,
  updateWorkpack,
  WorkpackUpdateError,
  type WorkpackRecord,
  type WorkpackUpdatePatch,
} from "@/lib/ops/workpacks";
import { renderWorkpackResultCard } from "@/lib/ops/slack-workpack-result-card";
import { postMessage } from "@/lib/ops/control-plane/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * When a workpack transitions to a terminal status (done / failed),
 * post a result card back to the original Slack thread so the
 * requester sees the completion in-context.
 *
 * Best-effort — Slack post failures NEVER fail the PATCH response.
 * The transition has already been persisted to KV; if the Slack post
 * misfires we surface it via the response's `slackPosted` flag, not
 * by rolling back the update.
 *
 * Skips silently when:
 *   - status is not terminal (the renderer returns null)
 *   - status didn't change (e.g. patch only updated resultSummary)
 *   - sourceUrl is missing (no thread to post to — try ops-daily as
 *     the channel of last resort)
 */
async function maybePostResultCard(args: {
  before: WorkpackRecord;
  after: WorkpackRecord;
}): Promise<{ posted: boolean; reason?: string }> {
  if (args.before.status === args.after.status) {
    return { posted: false, reason: "no-status-change" };
  }
  const card = renderWorkpackResultCard(args.after);
  if (!card) return { posted: false, reason: "non-terminal-status" };
  const sourceChannel = parseSlackChannelFromUrl(args.after.sourceUrl);
  const sourceTs = parseSlackTsFromUrl(args.after.sourceUrl);
  if (!sourceChannel) {
    return { posted: false, reason: "no-source-url" };
  }
  try {
    await postMessage({
      channel: sourceChannel,
      threadTs: sourceTs ?? undefined,
      text: card.text,
      blocks: card.blocks,
    });
    return { posted: true };
  } catch (err) {
    return {
      posted: false,
      reason: `slack-post-failed:${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Parse channel id from a Slack permalink URL. Returns null when not parseable. */
function parseSlackChannelFromUrl(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/\/archives\/([A-Z0-9]+)/i);
  return m ? m[1] : null;
}

/** Parse a Slack message ts from a permalink URL. */
function parseSlackTsFromUrl(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/\/p(\d{10})(\d{6})\b/);
  if (!m) return null;
  return `${m[1]}.${m[2]}`;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: RouteParams): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const workpack = await getWorkpack(id);
  if (!workpack) {
    return NextResponse.json(
      { ok: false, code: "not_found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, workpack });
}

export async function PATCH(req: Request, { params }: RouteParams): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: WorkpackUpdatePatch;
  try {
    body = (await req.json()) as WorkpackUpdatePatch;
  } catch {
    return NextResponse.json(
      { ok: false, code: "invalid_json" },
      { status: 400 },
    );
  }
  const { id } = await params;
  const before = await getWorkpack(id);
  try {
    const workpack = await updateWorkpack(id, body);
    let slackPost: { posted: boolean; reason?: string } = { posted: false };
    if (before) {
      slackPost = await maybePostResultCard({
        before,
        after: workpack,
      });
    }
    return NextResponse.json({
      ok: true,
      workpack,
      slackPost,
    });
  } catch (err) {
    if (err instanceof WorkpackUpdateError) {
      const status =
        err.code === "not_found"
          ? 404
          : err.code === "no_changes"
            ? 400
            : 422;
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status },
      );
    }
    throw err;
  }
}
