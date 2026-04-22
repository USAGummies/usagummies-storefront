/**
 * Viktor Pipeline Digest — weekly Monday morning #sales post.
 *
 * Bounded Viktor role per /contracts/viktor.md: HubSpot maintenance +
 * Slack Q&A. This runtime extends that with a weekly digest so Ben
 * has one-page visibility into B2B pipeline health without opening
 * HubSpot.
 *
 * Signals rendered:
 *   - Deal count + total $ by stage (Lead / PO Received / Shipped / Closed Won)
 *   - Stale deals (no HubSpot activity >14 days)
 *   - Deals expected to close this month (closedate within 30d)
 *   - Top 5 active deals by amount
 *
 * Degraded-mode contract: when `HUBSPOT_PRIVATE_APP_TOKEN` missing,
 * the digest renders "unavailable" + returns early without fabricating.
 *
 * Auth: bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getChannel } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import {
  HUBSPOT,
  isHubSpotConfigured,
  listRecentDeals,
  type PipelineDeal,
} from "@/lib/ops/hubspot-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_DAYS = 14;
const STAGE_LABEL: Record<string, string> = {
  [HUBSPOT.STAGE_LEAD]: "Lead",
  [HUBSPOT.STAGE_PO_RECEIVED]: "PO Received",
  [HUBSPOT.STAGE_SHIPPED]: "Shipped",
  [HUBSPOT.STAGE_CLOSED_WON]: "Closed Won",
};

function money(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

interface StageRollup {
  stage: string;
  label: string;
  count: number;
  totalDollars: number;
  staleCount: number;
}

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

  if (!isHubSpotConfigured()) {
    const rendered =
      ":bust_in_silhouette: *Viktor pipeline digest — DEGRADED*\n" +
      "`HUBSPOT_PRIVATE_APP_TOKEN` not configured. Wire it on Vercel to unblock weekly pipeline visibility.";
    if (shouldPost) await tryPost(rendered);
    return NextResponse.json({ ok: true, degraded: ["hubspot_not_configured"], rendered });
  }

  const deals = await listRecentDeals({ limit: 500 });
  const rollupByStage = new Map<string, StageRollup>();
  const staleDeals: PipelineDeal[] = [];
  const closingSoon: PipelineDeal[] = [];
  const now = Date.now();
  const thirtyDays = now + 30 * 24 * 3600 * 1000;

  for (const d of deals) {
    const label = STAGE_LABEL[d.dealstage] ?? (d.dealstage || "(unknown)");
    const entry =
      rollupByStage.get(d.dealstage) ??
      { stage: d.dealstage, label, count: 0, totalDollars: 0, staleCount: 0 };
    entry.count += 1;
    entry.totalDollars += d.amount ?? 0;
    const isOpen =
      d.dealstage !== HUBSPOT.STAGE_SHIPPED &&
      d.dealstage !== HUBSPOT.STAGE_CLOSED_WON;
    if (isOpen && d.daysSinceLastActivity > STALE_DAYS) {
      entry.staleCount += 1;
      staleDeals.push(d);
    }
    if (isOpen && d.closedate) {
      const closeTime = new Date(d.closedate).getTime();
      if (closeTime > 0 && closeTime <= thirtyDays) closingSoon.push(d);
    }
    rollupByStage.set(d.dealstage, entry);
  }

  const rollup = Array.from(rollupByStage.values()).sort(
    (a, b) => b.totalDollars - a.totalDollars,
  );
  const top5 = [...deals]
    .filter(
      (d) =>
        d.dealstage !== HUBSPOT.STAGE_SHIPPED &&
        d.dealstage !== HUBSPOT.STAGE_CLOSED_WON,
    )
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
    .slice(0, 5);

  const totalOpenDollars = rollup
    .filter(
      (r) =>
        r.stage !== HUBSPOT.STAGE_SHIPPED &&
        r.stage !== HUBSPOT.STAGE_CLOSED_WON,
    )
    .reduce((s, r) => s + r.totalDollars, 0);

  const lines: string[] = [
    `:bust_in_silhouette: *Viktor pipeline digest — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}*`,
    `_${deals.length} deals on B2B Wholesale pipeline · ${money(totalOpenDollars)} open_`,
    "",
    "*Stage breakdown:*",
  ];
  for (const r of rollup) {
    const stalePart = r.staleCount > 0 ? ` · :warning: ${r.staleCount} stale >${STALE_DAYS}d` : "";
    lines.push(
      `  • *${r.label}* — ${r.count} deal(s) · ${money(r.totalDollars)}${stalePart}`,
    );
  }

  if (closingSoon.length > 0) {
    lines.push("", "*Expected to close in 30 days:*");
    for (const d of closingSoon.slice(0, 5)) {
      lines.push(
        `  • ${d.dealname || d.id} · ${money(d.amount ?? 0)} · close ${d.closedate?.slice(0, 10) ?? "?"}`,
      );
    }
    if (closingSoon.length > 5) {
      lines.push(`  …and ${closingSoon.length - 5} more`);
    }
  }

  if (top5.length > 0) {
    lines.push("", "*Top 5 open deals by value:*");
    for (const d of top5) {
      lines.push(
        `  • ${d.dealname || d.id} · ${money(d.amount ?? 0)} · ${STAGE_LABEL[d.dealstage] ?? d.dealstage} · ${d.daysSinceLastActivity}d since activity`,
      );
    }
  }

  if (staleDeals.length > 0) {
    lines.push("", `*Stale (no activity >${STALE_DAYS}d):* ${staleDeals.length} deal(s). Viktor should nudge.`);
  }

  lines.push(
    "",
    "_Monday digest. Viktor maintains pipeline + answers questions in #sales. No autonomous writes outside HubSpot cleanup._",
  );

  const rendered = lines.join("\n");

  let posted = false;
  if (shouldPost) {
    posted = await tryPost(rendered);
  }

  return NextResponse.json({
    ok: true,
    posted,
    totalDeals: deals.length,
    totalOpenDollars: Math.round(totalOpenDollars * 100) / 100,
    rollup,
    closingSoonCount: closingSoon.length,
    staleCount: staleDeals.length,
    rendered,
  });
}

async function tryPost(text: string): Promise<boolean> {
  const channel = getChannel("sales") ?? getChannel("ops-daily");
  if (!channel) return false;
  try {
    const res = await postMessage({ channel: channel.name, text });
    return res.ok;
  } catch {
    return false;
  }
}
