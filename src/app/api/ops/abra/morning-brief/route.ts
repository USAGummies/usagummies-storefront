import { NextResponse } from "next/server";
import { isAuthorized, isCronAuthorized } from "@/lib/ops/abra-auth";
import {
  generateMorningBrief,
  generateMorningBriefPayload,
  sendMorningBrief,
} from "@/lib/ops/abra-morning-brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIEF_CACHE_TTL_MS = 2 * 60 * 1000;

let payloadCache:
  | {
      payload: Awaited<ReturnType<typeof generateMorningBriefPayload>>;
      expiresAt: number;
    }
  | null = null;

function buildPreviewBrief(
  payload: Awaited<ReturnType<typeof generateMorningBriefPayload>>,
): string {
  const revenueTotal = Number(payload.revenue.total_current || 0);
  const sessions = Number(payload.traffic.sessions?.current || 0);
  const openActions = Number(payload.open_action_items.total_open || 0);
  const anomalies = Number(payload.anomalies.count || 0);
  const signals = Number(payload.signals.count || 0);

  return [
    "🌅 ABRA MORNING BRIEF (Preview)",
    `Revenue total: $${revenueTotal.toFixed(2)}`,
    `Sessions: ${Math.round(sessions)}`,
    `Open actions: ${openActions}`,
    `Anomalies: ${anomalies}, Signals: ${signals}`,
  ].join("\n");
}

async function getCachedPayload(forceRefresh: boolean) {
  if (!forceRefresh && payloadCache && Date.now() < payloadCache.expiresAt) {
    return payloadCache.payload;
  }

  const payload = await generateMorningBriefPayload();
  payloadCache = {
    payload,
    expiresAt: Date.now() + BRIEF_CACHE_TTL_MS,
  };
  return payload;
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const mode = (url.searchParams.get("mode") || "quick").toLowerCase();
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const isFullMode = mode === "full";

    const payload = await getCachedPayload(forceRefresh);
    const briefText = isFullMode
      ? await generateMorningBrief()
      : buildPreviewBrief(payload);

    return NextResponse.json({
      ok: true,
      route: "morning-brief",
      mode: isFullMode ? "full" : "quick",
      payload,
      brief: briefText,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to generate morning brief preview",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await sendMorningBrief();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to send morning brief",
      },
      { status: 500 },
    );
  }
}
