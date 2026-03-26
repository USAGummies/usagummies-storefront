import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Client } from "@upstash/qstash";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import { runAllDueFeeds, runFeed } from "@/lib/ops/abra-auto-teach";
import { detectAnomalies } from "@/lib/ops/abra-anomaly-detection";
import { emitSignal } from "@/lib/ops/abra-operational-signals";
import { autoManageInitiatives } from "@/lib/ops/abra-initiative-health";
import {
  notifyCloseReady,
  postCloseToNotion,
  runMonthlyClose,
} from "@/lib/ops/abra-monthly-close";
import { sendMorningBrief, sendEndOfDaySummary } from "@/lib/ops/abra-morning-brief";
import { runDailyEvaluation } from "@/lib/ops/evaluation/daily-evaluation";
import { runEmailFetch } from "@/lib/ops/abra-email-fetch";
import { generateActionableEmailDrafts } from "@/lib/ops/abra-email-drafter";
import { processFinancialBrainEntries } from "@/lib/ops/abra-financial-processor";
import { learnFromSentMail } from "@/lib/ops/abra-sent-mail-learner";
import { backfillNullEmbeddings } from "@/lib/ops/abra-embeddings";
import { queryLedgerSummary } from "@/lib/ops/abra-notion-write";
import { runOperatorLoop } from "@/lib/ops/operator/operator-loop";
import { kv } from "@vercel/kv";
import { appendStateArray, readState, writeState, acquireKVLock, releaseKVLock } from "@/lib/ops/state";
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
  const lock: SchedulerLock = {
    run_id: randomUUID(),
    started_at: new Date(now).toISOString(),
    expires_at: new Date(now + LOCK_TTL_MS).toISOString(),
  };
  // Atomic lock: uses SET NX (set-if-not-exists) + PX (TTL) on Vercel KV.
  // This is race-free — only one cold start can acquire the lock.
  const acquired = await acquireKVLock(
    "abra-scheduler-lock",
    lock,
    LOCK_TTL_MS,
  );
  if (!acquired) return null;
  return lock;
}

async function releaseSchedulerLock(runId: string): Promise<void> {
  // Verify we still own the lock before releasing
  const current = await readState<SchedulerLock | null>("abra-scheduler-lock", null);
  if (!current || current.run_id !== runId) return;
  await releaseKVLock("abra-scheduler-lock");
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

    const operatorStep = await runStep("operator", async () =>
      runOperatorLoop(),
    );
    outcomes.push(operatorStep);

    // Learn from Ben's sent emails once per day (morning run only)
    if (inMorningWindow(nowPT)) {
      const sentMailStep = await runStep("sent_mail_learn", async () =>
        learnFromSentMail({ count: 30, daysBack: 7 }),
      );
      outcomes.push(sentMailStep);
    }

    // Pre-warm ledger cache for financial queries (avoids Notion pagination in real-time chat)
    const ledgerCacheStep = await runStep("ledger_cache", async () => {
      const currentYear = new Date().getFullYear();
      const years = [currentYear.toString(), (currentYear - 1).toString()];
      for (const year of years) {
        const ledger = await queryLedgerSummary({ fiscalYear: `FY${year}` });
        await kv.set(`abra:ledger:FY${year}`, ledger, { ex: 3600 });
      }
      return { cached: years };
    });
    outcomes.push(ledgerCacheStep);

    // Backfill any brain entries that have NULL embeddings
    const embeddingBackfillStep = await runStep("embedding_backfill", async () =>
      backfillNullEmbeddings(20),
    );
    outcomes.push(embeddingBackfillStep);

    const monthlyCloseStep = await runStep("monthly_close", async () => {
      if (!inMorningWindow(nowPT) || nowPT.getDate() !== 3) {
        return { skipped: true, reason: "not_due" };
      }

      const target = new Date(Date.UTC(nowPT.getFullYear(), nowPT.getMonth(), 0));
      const targetMonth = target.getUTCMonth() + 1;
      const targetYear = target.getUTCFullYear();
      const targetKey = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;
      const lastRunKey = await readState<string | null>(
        "abra-monthly-close-last-period" as never,
        null,
      );
      if (lastRunKey === targetKey) {
        return { skipped: true, reason: "already_ran", period: targetKey };
      }

      const report = await runMonthlyClose(targetMonth, targetYear);
      const pageId = await postCloseToNotion(report);
      await notifyCloseReady(report);
      await writeState("abra-monthly-close-last-period" as never, targetKey);

      return {
        skipped: false,
        period: targetKey,
        status: report.status,
        actionItems: report.actionItems.length,
        pageId,
      };
    });
    outcomes.push(monthlyCloseStep);

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
      daily_evaluation: false,
      morning_brief: false,
      weekly_digest: false,
      monthly_report: false,
    };
    if (inMorningWindow(nowPT)) {
      const evaluationStep = await runStep("daily_evaluation", async () => {
        const today = nowPT.toISOString().slice(0, 10);
        const lastRun = await readState<{ date?: string } | null>(
          "abra-evaluation-last-run",
          null,
        );
        if (lastRun?.date === today) {
          return { skipped: true, reason: "already_ran", date: today };
        }
        const result = await runDailyEvaluation(
          process.env.NEXTAUTH_URL || "https://www.usagummies.com",
        );
        await writeState("abra-evaluation-last-run", { date: today, passed: result.passed, failed: result.failed });
        return {
          skipped: false,
          passed: result.passed,
          failed: result.failed,
          promptVersion: result.promptVersion,
        };
      });
      outcomes.push(evaluationStep);
      notificationData.daily_evaluation = evaluationStep.ok;

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
    console.error("[scheduler] Fatal error:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      {
        error: "Scheduler cycle failed",
        run_id: lock.run_id,
      },
      { status: 500 },
    );
  } finally {
    await releaseSchedulerLock(lock.run_id);
  }
}
