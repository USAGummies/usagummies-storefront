/**
 * GET /api/ops/shipstation/wallet-check
 *
 * Daily ShipStation health digest. Combines:
 *   - BUILD #8 — wallet-balance floor check (stamps_com / ups_walleted /
 *     fedex_walleted). Alerts if any balance < the env-configured
 *     minimum so Ben can top up before a buy-loop stalls.
 *   - BUILD #9 — voided-label refund watcher. Flags any void >72h old
 *     whose Stamps.com refund hasn't surfaced yet.
 *
 * Query params:
 *   - post=true|false  — default false. When true, post to #operations.
 *
 * Auth: bearer CRON_SECRET (middleware whitelist).
 */
import { NextResponse } from "next/server";

import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import { getChannel } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import {
  digestContentFingerprint,
  shouldMirror,
} from "@/lib/ops/control-plane/slack/mirror-dedup";
import {
  listShipStationCarriers,
  listVoidedLabels,
} from "@/lib/ops/shipstation-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Floors per carrier. Overridable via env so Ben can tune without a
// redeploy. Values align with /contracts/integrations/shipstation.md §11.
// Per Ben 2026-04-30 PM: dropped UPS floor from $150 → $100. "We don't want
// tons of cash just sitting in shipping queue waiting for use. We want cash
// in the bank." Refill amounts are set in ShipStation UI directly (not via
// API) — operator follows /contracts/integrations/shipstation.md §11.
const DEFAULT_FLOORS: Record<string, number> = {
  stamps_com: 100,
  ups_walleted: 100,
  fedex_walleted: 100,
};

function floorFor(carrierCode: string): number {
  const envKey = `SHIPSTATION_WALLET_MIN_${carrierCode.toUpperCase()}`;
  const envVal = process.env[envKey]?.trim();
  if (envVal) {
    const n = Number.parseFloat(envVal);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_FLOORS[carrierCode] ?? 50;
}

interface WalletStatus {
  carrierCode: string;
  name: string;
  balance: number | null;
  floor: number;
  belowFloor: boolean;
  recommendedTopUp: number;
}

interface DigestResult {
  ok: boolean;
  generatedAt: string;
  wallets: WalletStatus[];
  walletAlerts: WalletStatus[];
  staleVoids: Array<{
    shipmentId: number;
    carrierCode: string | null;
    trackingNumber: string | null;
    cost: number | null;
    ageHours: number | null;
    voidDate: string | null;
    shipToName: string | null;
  }>;
  staleCount: number;
  stalePendingDollars: number;
  posted: boolean;
  postedTo: string | null;
  degraded: string[];
}

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  const url = new URL(req.url);
  const shouldPost = url.searchParams.get("post") === "true";
  const degraded: string[] = [];

  // --- Wallet balances ---
  const wallets: WalletStatus[] = [];
  const carriersRes = await listShipStationCarriers();
  if (!carriersRes.ok) {
    degraded.push(`wallet-read: ${carriersRes.error}`);
  } else {
    for (const c of carriersRes.carriers) {
      const code = c.code;
      if (!code) continue;
      // Only track walleted carriers (the ones we actually fund).
      if (!/(stamps_com|ups_walleted|fedex_walleted)/.test(code)) continue;
      const floor = floorFor(code);
      const balance = typeof c.balance === "number" ? c.balance : null;
      const belowFloor = balance !== null && balance < floor;
      wallets.push({
        carrierCode: code,
        name: c.name,
        balance,
        floor,
        belowFloor,
        // Round up to nearest $50; at least enough to clear 2× floor.
        recommendedTopUp:
          balance !== null && belowFloor
            ? Math.max(
                50,
                Math.ceil(((floor * 2 - balance) / 50)) * 50,
              )
            : 0,
      });
    }
  }
  const walletAlerts = wallets.filter((w) => w.belowFloor);

  // --- Voided-label refund watcher ---
  const staleVoids: DigestResult["staleVoids"] = [];
  let stalePendingDollars = 0;
  const voidRes = await listVoidedLabels({ daysBack: 14, staleAfterHours: 72 });
  if (!voidRes.ok) {
    degraded.push(`void-scan: ${voidRes.error}`);
  } else {
    for (const v of voidRes.stale) {
      staleVoids.push({
        shipmentId: v.shipmentId,
        carrierCode: v.carrierCode,
        trackingNumber: v.trackingNumber,
        cost: v.shipmentCost,
        ageHours: v.ageHours,
        voidDate: v.voidDate,
        shipToName: v.shipToName,
      });
      stalePendingDollars += v.shipmentCost ?? 0;
    }
  }
  stalePendingDollars = Math.round(stalePendingDollars * 100) / 100;

  // --- Render digest ---
  const lines: string[] = [];
  lines.push("🚚 ⭐ *SHIPSTATION CHECKPOINT* ⭐");
  lines.push(`_Generated ${new Date().toISOString()}_`);
  lines.push("");

  if (wallets.length === 0) {
    lines.push(":warning: _No walleted carriers reachable._");
  } else {
    lines.push("*Wallet balances:*");
    for (const w of wallets) {
      const bal = w.balance === null ? "—" : `$${w.balance.toFixed(2)}`;
      const icon = w.belowFloor ? ":rotating_light:" : ":white_check_mark:";
      const tail = w.belowFloor
        ? ` *BELOW FLOOR* — recommended top-up $${w.recommendedTopUp.toFixed(0)}`
        : "";
      lines.push(`${icon} \`${w.carrierCode}\`: ${bal} / floor $${w.floor.toFixed(0)}${tail}`);
    }
  }
  lines.push("");

  if (staleVoids.length > 0) {
    lines.push(
      `:money_with_wings: *${staleVoids.length} stale void(s)* (refund > 72h overdue): *$${stalePendingDollars.toFixed(2)}* pending`,
    );
    // Show up to 5 inline — full list on /api/ops/shipstation/voided-labels.
    for (const v of staleVoids.slice(0, 5)) {
      lines.push(
        `  • \`${v.trackingNumber ?? v.shipmentId}\` ${v.carrierCode ?? "—"} $${(v.cost ?? 0).toFixed(2)} — voided ${v.voidDate?.slice(0, 10) ?? "?"} (${v.ageHours ?? "?"}h ago) → ${v.shipToName ?? "?"}`,
      );
    }
    if (staleVoids.length > 5) {
      lines.push(`  … and ${staleVoids.length - 5} more`);
    }
  } else {
    lines.push(":white_check_mark: No stale void refunds pending.");
  }

  if (degraded.length > 0) {
    lines.push("");
    lines.push("*Degraded:*");
    for (const d of degraded) lines.push(`  • ${d}`);
  }

  const rendered = lines.join("\n");

  // --- Optional post ---
  let posted = false;
  let postedTo: string | null = null;
  const shouldAlert = walletAlerts.length > 0 || staleVoids.length > 0;
  if (shouldPost && shouldAlert) {
    // Post to #operations — Ben's channel. Wallet alerts are actionable
    // (he tops up); voided-label alerts are Rene's job but Ben needs
    // visibility because it gates his next buy-loop.
    const channel = getChannel("operations");
    if (channel) {
      // Content-hash dedup: same wallet balances + same 6 stale voids
      // reposted daily for 9 days running was pure noise. 24h TTL on
      // content fingerprint = post only when balance crosses floor or
      // a NEW void appears.
      const contentFp = digestContentFingerprint(rendered);
      const ok = await shouldMirror({
        fingerprint: ["wallet-check", contentFp],
        ttlSeconds: 86_400,
        namespace: "slack-mirror-dedup:v1:digest",
      });
      if (!ok) {
        degraded.push("slack-post: dedup-skip (no state change in last 24h)");
      } else {
        try {
          const res = await postMessage({
            channel: channel.name,
            text: rendered,
          });
          if (res.ok) {
            posted = true;
            postedTo = channel.name;
          } else {
            degraded.push(`slack-post: not ok`);
          }
        } catch (err) {
          degraded.push(
            `slack-post: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } else {
      degraded.push("slack-post: #operations channel not registered");
    }
  }

  const result: DigestResult = {
    ok: !degraded.length,
    generatedAt: new Date().toISOString(),
    wallets,
    walletAlerts,
    staleVoids,
    staleCount: staleVoids.length,
    stalePendingDollars,
    posted,
    postedTo,
    degraded,
  };

  return NextResponse.json({
    ...result,
    rendered,
  });
}
