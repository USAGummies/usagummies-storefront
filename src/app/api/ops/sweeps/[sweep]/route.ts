import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { kv } from "@vercel/kv";
import { notifyAlert } from "@/lib/ops/notify";
import { recordAgentRun } from "@/lib/ops/agent-performance";
import { runEmailSweep } from "@/lib/ops/sweeps/email-sweep";
import { runBankFeedSweep } from "@/lib/ops/sweeps/bank-feed-sweep";
import { runMorningBrief } from "@/lib/ops/sweeps/morning-brief";
import { runApprovalExpirySweep } from "@/lib/ops/sweeps/approval-expiry";
import { runEveningRecon } from "@/lib/ops/sweeps/evening-recon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SWEEP_HANDLERS = {
  "email-sweep": runEmailSweep,
  "bank-feed-sweep": runBankFeedSweep,
  "morning-brief": runMorningBrief,
  "approval-expiry": runApprovalExpirySweep,
  "evening-recon": runEveningRecon,
} as const;

function getReceiver(): Receiver | null {
  const signingKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!signingKey || !nextSigningKey) return null;
  return new Receiver({ currentSigningKey: signingKey, nextSigningKey });
}

async function verifyQStash(req: NextRequest, body: string): Promise<boolean> {
  const receiver = getReceiver();
  if (!receiver) return false;
  const signature = req.headers.get("upstash-signature");
  if (!signature) return false;
  try {
    await receiver.verify({ signature, body });
    return true;
  } catch {
    return false;
  }
}

function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization")?.trim();
  return Boolean(secret && auth === `Bearer ${secret}`);
}

async function acquireLock(sweep: string): Promise<boolean> {
  const key = `sweeps:lock:${sweep}`;
  try {
    const existing = await kv.get(key);
    if (existing) return false;
    await kv.set(key, "running", { ex: 300 });
  } catch {
    // KV unavailable — fail open
  }
  return true;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sweep: string }> },
) {
  const { sweep } = await params;
  const handler = SWEEP_HANDLERS[sweep as keyof typeof SWEEP_HANDLERS];
  if (!handler) {
    return NextResponse.json({ error: `Unknown sweep: ${sweep}` }, { status: 404 });
  }

  const rawBody = await req.text();
  const isQStash = await verifyQStash(req, rawBody);
  if (!isQStash && !isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const locked = await acquireLock(sweep);
  if (!locked) {
    return NextResponse.json({ ok: true, skipped: true, reason: "already running" });
  }

  const start = Date.now();
  try {
    const result = await handler();
    const durationMs = Date.now() - start;
    await recordAgentRun({
      engineId: "sweeps",
      agentKey: sweep,
      agentName: sweep,
      status: "success",
      durationMs,
      timestamp: new Date().toISOString(),
    });
    try {
      await kv.set(`scheduler:last_run:sweeps:${sweep}`, new Date().toISOString(), {
        ex: 7 * 86400,
      });
    } catch {
      // ignore
    }
    return NextResponse.json({ ok: true, sweep, durationMs, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - start;
    await recordAgentRun({
      engineId: "sweeps",
      agentKey: sweep,
      agentName: sweep,
      status: "failed",
      durationMs,
      timestamp: new Date().toISOString(),
      error: message,
    });
    try {
      const dedupKey = `abra:sweep:alert:${sweep}`;
      const alreadyAlerted = await kv.get(dedupKey);
      if (!alreadyAlerted) {
        await notifyAlert(`Sweep failed: ${sweep}\n${message}`).catch(() => {});
        await kv.set(dedupKey, "1", { ex: 1800 });
      }
    } catch {
      // KV unavailable — send alert anyway to avoid silent failures
      await notifyAlert(`Sweep failed: ${sweep}\n${message}`).catch(() => {});
    }
    return NextResponse.json(
      { ok: false, sweep, durationMs, error: message },
      { status: 500 },
    );
  }
}
