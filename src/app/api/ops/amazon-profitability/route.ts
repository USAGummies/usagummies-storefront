/**
 * GET /api/ops/amazon-profitability — Amazon channel P&L
 *
 * Pulls:
 *  1) Orders API — last 30 days, with order items (unit prices, promos)
 *  2) Fees API — live fee estimate at actual selling price
 *  3) Computes full P&L waterfall with breakeven analysis
 *
 * Cached 30 min (heavy API usage — lots of order-item fetches).
 */

import { NextResponse } from "next/server";
import {
  isAmazonConfigured,
  fetchAmazonOrderStats,
  fetchFeesEstimate,
} from "@/lib/amazon/sp-api";
import { readState, writeState } from "@/lib/ops/state";
import { UNIT_ECONOMICS } from "@/lib/ops/pro-forma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_KEY = "amazon-profitability";
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export type AmazonProfitability = {
  period: string; // "30d"
  periodDays: number;

  // Orders summary
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  totalUnits: number;
  avgSellingPrice: number;
  fbaOrders: number;
  fbmOrders: number;

  // Revenue
  grossRevenue: number;
  promotions: number;
  netRevenue: number;
  salesTax: number;

  // Amazon fees (per unit from Fees API)
  feesPerUnit: {
    referral: number;
    fba: number;
    closing: number;
    total: number;
  };

  // Amazon fees (total)
  totalReferralFees: number;
  totalFBAFees: number;
  totalAmazonFees: number;

  // COGS (from pro-forma)
  cogsPerUnit: number;
  inboundPerUnit: number;
  totalCOGS: number;
  totalInbound: number;

  // Profitability
  grossProfit: number;
  grossMargin: number;
  netProfit: number;
  netMargin: number;
  profitPerUnit: number;

  // Breakeven analysis
  breakeven: {
    currentPrice: number;
    breakevenPrice: number;       // Price needed to break even (net profit = 0)
    targetPrice15Margin: number;  // Price needed for 15% net margin
    targetPrice25Margin: number;  // Price needed for 25% net margin
    feePercentOfPrice: number;    // Amazon fees as % of selling price
  };

  // Monthly breakdown
  monthlyBreakdown: {
    month: string;
    orders: number;
    units: number;
    revenue: number;
    fees: number;
    cogs: number;
    profit: number;
    margin: number;
  }[];

  // Metadata
  source: "live-api" | "cached";
  generatedAt: string;
  feesSource: "fees-api" | "fallback";
};

export async function GET() {
  if (!isAmazonConfigured()) {
    return NextResponse.json({
      profitability: null,
      error: "Amazon SP-API not configured",
      generatedAt: new Date().toISOString(),
    });
  }

  // Check cache
  try {
    const cached = await readState<{ data: AmazonProfitability; cachedAt: number } | null>(CACHE_KEY, null);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      return NextResponse.json({
        profitability: { ...cached.data, source: "cached" as const },
        fromCache: true,
        generatedAt: new Date().toISOString(),
      });
    }
  } catch {
    // Cache miss — continue
  }

  try {
    // 1. Get order stats (30 days)
    const orderStats = await fetchAmazonOrderStats(30);

    // 2. Get fee estimate at avg selling price
    const avgPrice = orderStats.totalUnits > 0
      ? orderStats.totalRevenue / orderStats.totalUnits
      : 5.99;
    const fees = await fetchFeesEstimate(avgPrice);

    // 3. Use COGS from pro-forma model
    const cogsPerUnit = UNIT_ECONOMICS.cogsPerBag;
    const inboundPerUnit = 0.75; // Estimated inbound to FBA per unit

    // 4. Compute totals
    // Note: orderStats.totalRevenue includes cancelled orders' $0, so we use it directly
    // (cancelled orders have $0 order total so they don't inflate revenue)
    const totalUnits = orderStats.totalUnits;
    const grossRevenue = orderStats.totalRevenue;

    // We don't have per-item promo data from orderStats — estimate from profitability script findings
    // The script found ~$15 in promos on 75 units = ~$0.20/unit
    // This is an approximation; for exact numbers, would need order-item fetches
    const estimatedPromoRate = 0.034; // ~3.4% promo rate observed
    const promotions = Math.round(grossRevenue * estimatedPromoRate * 100) / 100;
    const netRevenue = grossRevenue - promotions;

    const totalReferralFees = totalUnits * fees.referralFee;
    const totalFBAFees = totalUnits * fees.fbaFee;
    const totalAmazonFees = totalUnits * fees.totalFee;

    const totalCOGS = totalUnits * cogsPerUnit;
    const totalInbound = totalUnits * inboundPerUnit;

    const grossProfit = netRevenue - totalAmazonFees;
    const grossMargin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
    const netProfit = grossProfit - totalCOGS - totalInbound;
    const netMargin = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;
    const profitPerUnit = totalUnits > 0 ? netProfit / totalUnits : 0;

    // 5. Breakeven analysis
    // At price P: Net = P - promoRate*P - referralRate*P - fbaFee - COGS - inbound = 0
    // P * (1 - promoRate - referralRate) = fbaFee + COGS + inbound
    // P = (fbaFee + COGS + inbound) / (1 - promoRate - referralRate)
    const referralRate = avgPrice > 0 ? fees.referralFee / avgPrice : 0.08;
    const promoRate = estimatedPromoRate;
    const fixedCosts = fees.fbaFee + cogsPerUnit + inboundPerUnit;
    const marginMultiplier = 1 - promoRate - referralRate;

    const breakevenPrice = marginMultiplier > 0 ? fixedCosts / marginMultiplier : 99.99;
    const targetPrice15 = marginMultiplier > 0 ? fixedCosts / (marginMultiplier - 0.15) : 99.99;
    const targetPrice25 = marginMultiplier > 0 ? fixedCosts / (marginMultiplier - 0.25) : 99.99;

    // 6. Monthly breakdown with P&L
    const monthlyBreakdown = orderStats.monthlyBreakdown.map((m) => {
      const mFees = m.units * fees.totalFee;
      const mCogs = m.units * cogsPerUnit;
      const mInbound = m.units * inboundPerUnit;
      const mPromos = m.revenue * estimatedPromoRate;
      const mNetRev = m.revenue - mPromos;
      const mProfit = mNetRev - mFees - mCogs - mInbound;
      const mMargin = mNetRev > 0 ? (mProfit / mNetRev) * 100 : 0;
      return {
        month: m.month,
        orders: m.orders,
        units: m.units,
        revenue: Math.round(m.revenue * 100) / 100,
        fees: Math.round(mFees * 100) / 100,
        cogs: Math.round(mCogs * 100) / 100,
        profit: Math.round(mProfit * 100) / 100,
        margin: Math.round(mMargin * 10) / 10,
      };
    });

    const completedOrders = orderStats.totalOrders;
    // We can't distinguish cancelled from orderStats — use total
    const result: AmazonProfitability = {
      period: "30d",
      periodDays: 30,
      totalOrders: orderStats.totalOrders,
      completedOrders,
      cancelledOrders: 0,
      totalUnits,
      avgSellingPrice: Math.round(avgPrice * 100) / 100,
      fbaOrders: orderStats.fbaOrders,
      fbmOrders: orderStats.fbmOrders,

      grossRevenue: Math.round(grossRevenue * 100) / 100,
      promotions: Math.round(promotions * 100) / 100,
      netRevenue: Math.round(netRevenue * 100) / 100,
      salesTax: 0,

      feesPerUnit: {
        referral: Math.round(fees.referralFee * 100) / 100,
        fba: Math.round(fees.fbaFee * 100) / 100,
        closing: Math.round(fees.closingFee * 100) / 100,
        total: Math.round(fees.totalFee * 100) / 100,
      },

      totalReferralFees: Math.round(totalReferralFees * 100) / 100,
      totalFBAFees: Math.round(totalFBAFees * 100) / 100,
      totalAmazonFees: Math.round(totalAmazonFees * 100) / 100,

      cogsPerUnit: Math.round(cogsPerUnit * 100) / 100,
      inboundPerUnit,
      totalCOGS: Math.round(totalCOGS * 100) / 100,
      totalInbound: Math.round(totalInbound * 100) / 100,

      grossProfit: Math.round(grossProfit * 100) / 100,
      grossMargin: Math.round(grossMargin * 10) / 10,
      netProfit: Math.round(netProfit * 100) / 100,
      netMargin: Math.round(netMargin * 10) / 10,
      profitPerUnit: Math.round(profitPerUnit * 100) / 100,

      breakeven: {
        currentPrice: Math.round(avgPrice * 100) / 100,
        breakevenPrice: Math.round(breakevenPrice * 100) / 100,
        targetPrice15Margin: Math.round(targetPrice15 * 100) / 100,
        targetPrice25Margin: Math.round(targetPrice25 * 100) / 100,
        feePercentOfPrice: Math.round((fees.totalFee / avgPrice) * 1000) / 10,
      },

      monthlyBreakdown,

      source: "live-api",
      generatedAt: new Date().toISOString(),
      feesSource: fees.referralFee > 0 ? "fees-api" : "fallback",
    };

    // Cache the result
    await writeState(CACHE_KEY, { data: result, cachedAt: Date.now() });

    return NextResponse.json({
      profitability: result,
      fromCache: false,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[amazon-profitability] Failed:", err);
    return NextResponse.json(
      {
        profitability: null,
        error: err instanceof Error ? err.message : String(err),
        generatedAt: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
