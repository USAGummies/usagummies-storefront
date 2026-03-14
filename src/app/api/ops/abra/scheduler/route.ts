import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Client } from "@upstash/qstash";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import { runAllDueFeeds, runFeed } from "@/lib/ops/abra-auto-teach";
import { detectAnomalies } from "@/lib/ops/abra-anomaly-detection";
import { emitSignal } from "@/lib/ops/abra-operational-signals";
import { autoManageInitiatives } from "@/lib/ops/abra-initiative-health";
import { sendMorningBrief, sendEndOfDaySummary } from "@/lib/ops/abra-morning-brief";
import { runEmailFetch } from "@/lib/ops/abra-email-fetch";
import { generateActionableEmailDrafts } from "@/lib/ops/abra-email-drafter";
import { processFinancialBrainEntries } from "@/lib/ops/abra-financial-processor";
import { appendStateArray, readState, writeState } from "@/lib/ops/state";
import { notify } from "@/lib/ops/notify";
import {
  sendWeeklyDigest,
  sendMonthlyReport,
} from "@/lib/ops/abra-weekly-digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function getPTNow(): Date {
  const now = new Date();
  const pt = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  return new Date(pt);
}

function inMorningWindow(date: Date): boolean {
  const hour = date.getHours();
  return hour >= 5 && hour < 10; // 5am to catch Vercel cron at 1pm UTC (5am PT)
}

function inEveningWindow(date: Date): boolean {
  const hour = date.getHours();
  return hour >= 20 && hour < 22; // 8-10pm PT for end-of-day summary
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

type SchedulerLedgerEntry = {
  run_id: string;
  timestamp: string;
  mode: "feed" | "cycle";
  feed?: string;
  ok: boolean;
  errors: Array<{ step: string; error: string }>;
};

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

function formatStepSummary(step: StepOutcome): string {
  return `• ${step.name}: ${step.ok ? "ok" : `failed (${step.error || "unknown"})`} in ${step.duration_ms}ms`;
}

async function notifySchedulerFailure(params: {
  runId: string;
  errors: Array<{ step: string; error: string }>;
  outcomes: StepOutcome[];
}) {
  if (!params.errors.length) return;
  const text =
    `🚨 *Abra Scheduler Failure* (run ${params.runId})\n` +
    params.errors
      .slice(0, 5)
      .map((row) => `• ${row.step}: ${row.error}`)
      .join("\n") +
    `\n\nStep summary:\n${params.outcomes.map(formatStepSummary).join("\n")}`;

  await notify({ channel: "alerts", text });
}

async function recordSchedulerLedger(entry: SchedulerLedgerEntry): Promise<void> {
  try {
    await appendStateArray("abra-scheduler-ledger" as never, [entry], 1000);
  } catch {
    // best-effort
  }
}

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
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
  const reqUrl = new URL(req.url);
  const targetFeed = reqUrl.searchParams.get("feed");
  const outcomes: StepOutcome[] = [];

  try {
    if (targetFeed) {
      const feedStep = await runStep("feed", async () => runFeed(targetFeed));
      outcomes.push(feedStep);
      const errors = feedStep.ok
        ? []
        : [{ step: "feed", error: feedStep.error || "unknown error" }];
      const responsePayload = {
        ok: errors.length === 0,
        run_id: lock.run_id,
        timestamp: new Date().toISOString(),
        mode: "feed",
        feed: targetFeed,
        steps: outcomes,
        errors,
      };
      await recordSchedulerLedger({
        run_id: lock.run_id,
        timestamp: responsePayload.timestamp,
        mode: "feed",
        feed: targetFeed,
        ok: responsePayload.ok,
        errors,
      });
      return NextResponse.json(responsePayload, {
        status: responsePayload.ok ? 200 : 207,
      });
    }

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

    const emailFetchStep = await runStep("email_fetch", async () =>
      runEmailFetch({ count: 50 }),
    );
    outcomes.push(emailFetchStep);

    const emailDraftsStep = await runStep("email_drafts", async () =>
      generateActionableEmailDrafts({ limit: 10 }),
    );
    outcomes.push(emailDraftsStep);

    const financialStep = await runStep("financial_process", async () =>
      processFinancialBrainEntries({ limit: 10 }),
    );
    outcomes.push(financialStep);

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

      // Schedule evening callback via QStash — Vercel Hobby only has 1 daily cron,
      // so we self-schedule for the EOD summary window (~8pm PT = ~4am UTC next day,
      // but we compute the exact delay from now to 8pm PT today).
      const scheduleStep = await runStep("schedule_evening", async () => {
        const qstashToken = process.env.QSTASH_TOKEN;
        if (!qstashToken) return "no_qstash";

        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : process.env.NEXTAUTH_URL || "https://www.usagummies.com";
        const cronSecret = process.env.CRON_SECRET;

        // Compute seconds until 8pm PT today
        const targetHour = 20; // 8pm PT
        const ptNow = getPTNow();
        const targetTime = new Date(ptNow);
        targetTime.setHours(targetHour, 0, 0, 0);
        const delaySeconds = Math.max(
          60, // minimum 1 minute
          Math.floor((targetTime.getTime() - ptNow.getTime()) / 1000),
        );

        if (delaySeconds > 18 * 3600) return "too_far_away"; // sanity: >18h is wrong

        const qstash = new Client({ token: qstashToken });
        const res = await qstash.publishJSON({
          url: `${baseUrl}/api/ops/abra/scheduler`,
          body: { triggeredBy: "evening-callback" },
          headers: cronSecret ? { authorization: `Bearer ${cronSecret}` } : {},
          delay: delaySeconds,
          retries: 2,
        });
        const msgId = "messageId" in res ? res.messageId : "batch";
        return `scheduled_in_${Math.round(delaySeconds / 3600)}h (msgId: ${msgId})`;
      });
      outcomes.push(scheduleStep);
    }
    if (inEveningWindow(nowPT)) {
      const eodStep = await runStep("end_of_day_summary", sendEndOfDaySummary);
      outcomes.push(eodStep);
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
    if (errors.length > 0) {
      void notifySchedulerFailure({
        runId: lock.run_id,
        errors,
        outcomes,
      }).catch(() => {});
    }

    const timestamp = new Date().toISOString();
    await recordSchedulerLedger({
      run_id: lock.run_id,
      timestamp,
      mode: "cycle",
      ok: errors.length === 0,
      errors,
    });

    return NextResponse.json(
      {
        ok: errors.length === 0,
        run_id: lock.run_id,
        timestamp,
        steps: outcomes,
        notifications: notificationData,
        errors,
      },
      { status: errors.length > 0 ? 207 : 200 },
    );
  } catch (error) {
    await recordSchedulerLedger({
      run_id: lock.run_id,
      timestamp: new Date().toISOString(),
      mode: targetFeed ? "feed" : "cycle",
      ...(targetFeed ? { feed: targetFeed } : {}),
      ok: false,
      errors: [
        {
          step: "fatal",
          error: error instanceof Error ? error.message : "Scheduler cycle failed",
        },
      ],
    });
    void notify({
      channel: "alerts",
      text:
        `🚨 *Abra Scheduler Fatal Error* (run ${lock.run_id})\n` +
        `• ${error instanceof Error ? error.message : "Scheduler cycle failed"}`,
    }).catch(() => {});
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
