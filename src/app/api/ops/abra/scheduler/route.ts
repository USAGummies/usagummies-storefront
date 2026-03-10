import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { runAllDueFeeds } from "@/lib/ops/abra-auto-teach";
import { detectAnomalies } from "@/lib/ops/abra-anomaly-detection";
import { emitSignal } from "@/lib/ops/abra-operational-signals";
import { autoManageInitiatives } from "@/lib/ops/abra-initiative-health";
import { sendMorningBrief } from "@/lib/ops/abra-morning-brief";
import { readState, writeState } from "@/lib/ops/state";
import {
  sendWeeklyDigest,
  sendMonthlyReport,
} from "@/lib/ops/abra-weekly-digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  return !!secret && authHeader === `Bearer ${secret}`;
}

function getPTNow(): Date {
  const now = new Date();
  const pt = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  return new Date(pt);
}

function inMorningWindow(date: Date): boolean {
  const hour = date.getHours();
  return hour >= 6 && hour < 10;
}

type SchedulerLock = {
  run_id: string;
  started_at: string;
  expires_at: string;
};

type StepOutcome<T = unknown> = {
  name: string;
  ok: boolean;
  duration_ms: number;
  error?: string;
  data?: T;
};

const LOCK_TTL_MS = 20 * 60 * 1000;

async function acquireSchedulerLock(): Promise<SchedulerLock | null> {
  const now = Date.now();
  const current = await readState<SchedulerLock | null>(
    "abra-scheduler-lock",
    null,
  );
  if (
    current &&
    typeof current.expires_at === "string" &&
    new Date(current.expires_at).getTime() > now
  ) {
    return null;
  }

  const lock: SchedulerLock = {
    run_id: randomUUID(),
    started_at: new Date(now).toISOString(),
    expires_at: new Date(now + LOCK_TTL_MS).toISOString(),
  };
  await writeState("abra-scheduler-lock", lock);
  const verify = await readState<SchedulerLock | null>(
    "abra-scheduler-lock",
    null,
  );
  if (!verify || verify.run_id !== lock.run_id) {
    return null;
  }
  return lock;
}

async function releaseSchedulerLock(runId: string): Promise<void> {
  const current = await readState<SchedulerLock | null>("abra-scheduler-lock", null);
  if (!current || current.run_id !== runId) return;
  await writeState("abra-scheduler-lock", {
    ...current,
    expires_at: new Date(Date.now() - 1000).toISOString(),
  });
}

async function runStep<T>(name: string, fn: () => Promise<T>): Promise<StepOutcome<T>> {
  const start = Date.now();
  try {
    const data = await fn();
    return {
      name,
      ok: true,
      duration_ms: Date.now() - start,
      data,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      duration_ms: Date.now() - start,
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lock = await acquireSchedulerLock();
  if (!lock) {
    return NextResponse.json(
      {
        error: "Scheduler already running",
        code: "scheduler_locked",
      },
      { status: 409 },
    );
  }

  const nowPT = getPTNow();
  const outcomes: StepOutcome[] = [];

  try {
    const feedsStep = await runStep("feeds", async () => {
      const feedResults = await runAllDueFeeds();
      return {
        total: feedResults.length,
        success: feedResults.filter((row) => row.success).length,
        failed: feedResults.filter((row) => !row.success).length,
        entries_created: feedResults.reduce(
          (sum, row) => sum + Number(row.entriesCreated || 0),
          0,
        ),
      };
    });
    outcomes.push(feedsStep);

    const anomaliesStep = await runStep("anomalies", async () => {
      const anomalies = await detectAnomalies();
      const emitResults = await Promise.allSettled(
        anomalies.map((anomaly) =>
          emitSignal({
            signal_type: "metric_anomaly",
            source: "anomaly_detection",
            title: anomaly.context,
            detail: `${anomaly.metric}: ${anomaly.current_value} (expected ~${anomaly.expected_value.toFixed(2)}, z=${anomaly.z_score.toFixed(2)})`,
            severity: anomaly.severity,
            department: anomaly.department,
            metadata: anomaly,
          }),
        ),
      );
      return {
        count: anomalies.length,
        emitted: emitResults.filter((result) => result.status === "fulfilled")
          .length,
      };
    });
    outcomes.push(anomaliesStep);

    const initiativeStep = await runStep("initiative_health", async () =>
      autoManageInitiatives(),
    );
    outcomes.push(initiativeStep);

    const notificationData = {
      morning_brief: false,
      weekly_digest: false,
      monthly_report: false,
    };
    if (inMorningWindow(nowPT)) {
      const briefStep = await runStep("morning_brief", sendMorningBrief);
      outcomes.push(briefStep);
      notificationData.morning_brief = briefStep.ok;
    }
    if (nowPT.getDay() === 1) {
      const weeklyStep = await runStep("weekly_digest", sendWeeklyDigest);
      outcomes.push(weeklyStep);
      notificationData.weekly_digest = weeklyStep.ok;
    }
    if (nowPT.getDate() === 1) {
      const monthlyStep = await runStep("monthly_report", sendMonthlyReport);
      outcomes.push(monthlyStep);
      notificationData.monthly_report = monthlyStep.ok;
    }

    const errors = outcomes
      .filter((step) => !step.ok)
      .map((step) => ({ step: step.name, error: step.error || "unknown error" }));

    return NextResponse.json(
      {
        ok: errors.length === 0,
        run_id: lock.run_id,
        timestamp: new Date().toISOString(),
        steps: outcomes,
        notifications: notificationData,
        errors,
      },
      { status: errors.length > 0 ? 207 : 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Scheduler cycle failed",
        run_id: lock.run_id,
      },
      { status: 500 },
    );
  } finally {
    await releaseSchedulerLock(lock.run_id);
  }
}
