import { NextResponse } from "next/server";
import { readState, writeState } from "@/lib/ops/state";
import { notifyAlert } from "@/lib/ops/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type MarketingTest = {
  id: string;
  name: string;
  channel: string;
  hypothesis: string;
  startDate: string;
  endDate: string | null;
  status: "active" | "completed" | "paused";
  spend: number;
  revenue: number;
  roas: number;
  impressions: number;
  clicks: number;
  creative: string;
  audience: string;
  result: "winner" | "loser" | "inconclusive" | null;
};

type IntelligenceResponse = {
  tests: MarketingTest[];
  opportunities: Array<MarketingTest & { suggestedScaleBudget: number }>;
  channelRoas: Array<{ channel: string; spend: number; revenue: number; roas: number }>;
  summary: {
    activeTests: number;
    avgRoas: number;
    bestPerformer: string;
    totalTestSpend: number;
  };
  generatedAt: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function recalc(test: MarketingTest): MarketingTest {
  const spend = Number(test.spend || 0);
  const revenue = Number(test.revenue || 0);
  const roas = spend > 0 ? round2(revenue / spend) : 0;
  return {
    ...test,
    spend,
    revenue,
    impressions: Number(test.impressions || 0),
    clicks: Number(test.clicks || 0),
    roas,
  };
}

function computeResponse(tests: MarketingTest[]): IntelligenceResponse {
  const recalced = tests.map(recalc);
  const opportunities = recalced
    .filter((t) => t.roas > 3 && t.spend > 100 && t.impressions > 1000)
    .map((t) => ({ ...t, suggestedScaleBudget: round2(t.spend * 10) }));

  const byChannel = new Map<string, { spend: number; revenue: number }>();
  for (const test of recalced) {
    const current = byChannel.get(test.channel) || { spend: 0, revenue: 0 };
    current.spend += test.spend;
    current.revenue += test.revenue;
    byChannel.set(test.channel, current);
  }

  const channelRoas = Array.from(byChannel.entries())
    .map(([channel, totals]) => ({
      channel,
      spend: round2(totals.spend),
      revenue: round2(totals.revenue),
      roas: totals.spend > 0 ? round2(totals.revenue / totals.spend) : 0,
    }))
    .sort((a, b) => b.roas - a.roas);

  const active = recalced.filter((t) => t.status === "active");
  const avgRoas = recalced.length > 0 ? round2(recalced.reduce((sum, t) => sum + t.roas, 0) / recalced.length) : 0;
  const best = recalced.slice().sort((a, b) => b.roas - a.roas)[0];

  return {
    tests: recalced,
    opportunities,
    channelRoas,
    summary: {
      activeTests: active.length,
      avgRoas,
      bestPerformer: best?.name || "None",
      totalTestSpend: round2(recalced.reduce((sum, t) => sum + t.spend, 0)),
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  const tests = await readState<MarketingTest[]>("marketing-tests-cache", []);
  return NextResponse.json(computeResponse(Array.isArray(tests) ? tests : []));
}

type Body = {
  action?: "add" | "update" | "close";
  test?: Partial<MarketingTest>;
  id?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const existing = await readState<MarketingTest[]>("marketing-tests-cache", []);
    const tests = Array.isArray(existing) ? [...existing] : [];

    if (body.action === "add") {
      const input = body.test || {};
      const created: MarketingTest = recalc({
        id: `test-${Date.now()}`,
        name: String(input.name || "Untitled Test"),
        channel: String(input.channel || "unknown"),
        hypothesis: String(input.hypothesis || ""),
        startDate: String(input.startDate || new Date().toISOString().slice(0, 10)),
        endDate: null,
        status: "active",
        spend: Number(input.spend || 0),
        revenue: Number(input.revenue || 0),
        roas: 0,
        impressions: Number(input.impressions || 0),
        clicks: Number(input.clicks || 0),
        creative: String(input.creative || ""),
        audience: String(input.audience || ""),
        result: null,
      });
      tests.unshift(created);
    } else if (body.action === "update") {
      if (!body.id) {
        return NextResponse.json({ error: "id is required for update" }, { status: 400 });
      }
      const idx = tests.findIndex((t) => t.id === body.id);
      if (idx === -1) {
        return NextResponse.json({ error: "Test not found" }, { status: 404 });
      }
      tests[idx] = recalc({ ...tests[idx], ...(body.test || {}) } as MarketingTest);
    } else if (body.action === "close") {
      if (!body.id) {
        return NextResponse.json({ error: "id is required for close" }, { status: 400 });
      }
      const idx = tests.findIndex((t) => t.id === body.id);
      if (idx === -1) {
        return NextResponse.json({ error: "Test not found" }, { status: 404 });
      }
      tests[idx] = recalc({
        ...tests[idx],
        status: "completed",
        endDate: new Date().toISOString().slice(0, 10),
      });
    } else {
      return NextResponse.json({ error: "Unsupported action. Use add | update | close" }, { status: 400 });
    }

    await writeState("marketing-tests-cache", tests);
    const computed = computeResponse(tests);

    // Only alert for NEW high-ROAS opportunities (not previously alerted)
    const alertedIds = await readState<string[]>("marketing-alerted-high-roas", []);
    const alerted = new Set(Array.isArray(alertedIds) ? alertedIds : []);
    const newAlerts: string[] = [];

    for (const opportunity of computed.opportunities) {
      if (opportunity.status === "active" && !alerted.has(opportunity.id)) {
        notifyAlert(
          `🟡 HIGH ROAS OPPORTUNITY: ${opportunity.name} (${opportunity.channel}) ROAS ${opportunity.roas.toFixed(
            2,
          )}. Suggested scale budget: $${opportunity.suggestedScaleBudget.toLocaleString("en-US")}`,
        ).catch(() => {});
        newAlerts.push(opportunity.id);
      }
    }

    if (newAlerts.length > 0) {
      await writeState("marketing-alerted-high-roas", [...alerted, ...newAlerts]);
    }

    return NextResponse.json({ ok: true, ...computed });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
