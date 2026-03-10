import { NextResponse } from "next/server";
import { runAllDueFeeds } from "@/lib/ops/abra-auto-teach";
import { detectAnomalies } from "@/lib/ops/abra-anomaly-detection";
import { emitSignal } from "@/lib/ops/abra-operational-signals";
import { autoManageInitiatives } from "@/lib/ops/abra-initiative-health";
import { sendMorningBrief } from "@/lib/ops/abra-morning-brief";
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

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowPT = getPTNow();

  try {
    const feedResults = await runAllDueFeeds();
    const anomalies = await detectAnomalies();
    for (const anomaly of anomalies) {
      void emitSignal({
        signal_type: "metric_anomaly",
        source: "anomaly_detection",
        title: anomaly.context,
        detail: `${anomaly.metric}: ${anomaly.current_value} (expected ~${anomaly.expected_value.toFixed(2)}, z=${anomaly.z_score.toFixed(2)})`,
        severity: anomaly.severity,
        department: anomaly.department,
        metadata: anomaly,
      });
    }

    const initiativeHealth = await autoManageInitiatives();

    let morningBriefSent = false;
    let weeklyDigestSent = false;
    let monthlyReportSent = false;

    if (inMorningWindow(nowPT)) {
      await sendMorningBrief();
      morningBriefSent = true;
    }
    if (nowPT.getDay() === 1) {
      await sendWeeklyDigest();
      weeklyDigestSent = true;
    }
    if (nowPT.getDate() === 1) {
      await sendMonthlyReport();
      monthlyReportSent = true;
    }

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      feeds: {
        total: feedResults.length,
        success: feedResults.filter((row) => row.success).length,
        failed: feedResults.filter((row) => !row.success).length,
        entries_created: feedResults.reduce(
          (sum, row) => sum + Number(row.entriesCreated || 0),
          0,
        ),
      },
      anomalies: {
        count: anomalies.length,
      },
      initiatives: initiativeHealth,
      notifications: {
        morning_brief: morningBriefSent,
        weekly_digest: weeklyDigestSent,
        monthly_report: monthlyReportSent,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Scheduler cycle failed",
      },
      { status: 500 },
    );
  }
}
