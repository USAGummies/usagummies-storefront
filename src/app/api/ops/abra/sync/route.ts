/**
 * POST /api/ops/abra/sync — Trigger on-demand Notion/email sync
 *
 * Body: {
 *   target: "all" | "b2b" | "distributors" | "skus" | "performance" |
 *           "repackers" | "cash" | "agent_run_log" | "email",
 *   max?: number,           // max records per DB (default 50)
 *   fetchContent?: boolean, // fetch page blocks (default true)
 * }
 *
 * Runs the sync script as a child process and streams progress.
 * Returns immediately with a job ID; poll /api/ops/abra/sync?jobId=... for status.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { execFile } from "node:child_process";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes max

const VALID_TARGETS = [
  "all",
  "b2b",
  "distributors",
  "skus",
  "performance",
  "repackers",
  "cash",
  "agent_run_log",
  "email",
];

// In-memory job tracker (simple — single instance)
const jobs = new Map<
  string,
  { status: string; target: string; output: string; startedAt: string; finishedAt?: string }
>();

function genId() {
  return `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * POST — Start a sync job
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { target?: string; max?: number; fetchContent?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const target = body.target || "all";
  if (!VALID_TARGETS.includes(target)) {
    return NextResponse.json(
      { error: `Invalid target. Valid: ${VALID_TARGETS.join(", ")}` },
      { status: 400 },
    );
  }

  const max = body.max || 50;
  const fetchContent = body.fetchContent !== false;

  const jobId = genId();
  const scriptsDir = path.join(process.cwd(), "scripts");

  jobs.set(jobId, {
    status: "running",
    target,
    output: "",
    startedAt: new Date().toISOString(),
  });

  // Determine which script + args to run
  let scriptFile: string;
  let args: string[];

  if (target === "email") {
    scriptFile = path.join(scriptsDir, "abra-email-ingest.mjs");
    args = ["--max", String(max)];
  } else {
    scriptFile = path.join(scriptsDir, "abra-notion-sync.mjs");
    args = ["--db", target, "--max", String(max)];
    if (!fetchContent) args.push("--no-content");
  }

  // Fire and forget — run in background
  const child = execFile("node", [scriptFile, ...args], {
    timeout: 280_000, // 280s safety cap
    env: process.env,
    maxBuffer: 5 * 1024 * 1024, // 5MB output buffer
  });

  let output = "";
  child.stdout?.on("data", (chunk: string) => {
    output += chunk;
    const job = jobs.get(jobId);
    if (job) job.output = output;
  });
  child.stderr?.on("data", (chunk: string) => {
    output += chunk;
    const job = jobs.get(jobId);
    if (job) job.output = output;
  });

  child.on("close", (code) => {
    const job = jobs.get(jobId);
    if (job) {
      job.status = code === 0 ? "completed" : "failed";
      job.output = output;
      job.finishedAt = new Date().toISOString();
    }
    // Clean up old jobs after 10 minutes
    setTimeout(() => jobs.delete(jobId), 10 * 60 * 1000);
  });

  return NextResponse.json({
    jobId,
    target,
    max,
    fetchContent,
    status: "running",
    message: `Sync started for "${target}". Poll GET /api/ops/abra/sync?jobId=${jobId} for progress.`,
  });
}

/**
 * GET — Check sync job status
 * Query params: ?jobId=sync-... OR no params for a list of recent jobs
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");

  if (jobId) {
    const job = jobs.get(jobId);
    if (!job) {
      return NextResponse.json(
        { error: "Job not found (may have expired)" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      jobId,
      ...job,
      // Truncate output to last 5000 chars for response size
      output: job.output.length > 5000 ? "..." + job.output.slice(-5000) : job.output,
    });
  }

  // List all active/recent jobs
  const jobList = Array.from(jobs.entries()).map(([id, job]) => ({
    jobId: id,
    target: job.target,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  }));

  return NextResponse.json({ jobs: jobList });
}
