/**
 * USA Gummies — Pro Forma v23 | Full Year 2026
 *
 * All financial targets, unit projections, and KPI benchmarks
 * extracted from USA_Gummies_Pro_Forma_2026_v23.xlsx
 *
 * This is the SINGLE SOURCE OF TRUTH for plan-vs-actual comparison
 * across the entire War Room dashboard.
 *
 * v23 changes from v22:
 *   — Added $500/mo contingency line to OpEx
 *   — Added loan amortization principal/interest split
 *   — Added projected monthly cash balance
 *   — Added inventory at cost monthly tracking
 *   — Added founder capital-to-date breakdown
 *   — Corrected EBITDA = GP − full OpEx (spreadsheet formula errors fixed)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Month = 'mar' | 'apr' | 'may' | 'jun' | 'jul' | 'aug' | 'sep' | 'oct' | 'nov' | 'dec';

export type MonthlyData = Record<Month, number>;

export type ChannelMetrics = {
  units: MonthlyData;
  revenue: MonthlyData;
  grossProfit: MonthlyData;
};

export type CapitalLineItem = {
  category: string;
  amount: number;
  deployMonth: string;
  notes: string;
};

export type LoanMonth = {
  month: string;
  revenue: number;
  repayment: number;
  cumulativeRepaid: number;
  balanceRemaining: number;
};

export type AmortizationMonth = {
  month: string;
  grossRevenue: number;
  totalPayment: number;
  principalPortion: number;
  interestPortion: number;
  cumulativePrincipal: number;
  cumulativeInterest: number;
  principalBalance: number;
};

export type CapitalToDateEntry = {
  category: string;
  amount: number;
  period: string;
  notes: string;
};

export type Milestone = {
  id: string;
  label: string;
  targetMonth: Month | string;
  metric: string;
  threshold: number;
  unit: string;
};

// ---------------------------------------------------------------------------
// Month helpers
// ---------------------------------------------------------------------------

export const MONTHS: Month[] = ['mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export const MONTH_LABELS: Record<Month, string> = {
  mar: 'Mar', apr: 'Apr', may: 'May', jun: 'Jun', jul: 'Jul*',
  aug: 'Aug', sep: 'Sep', oct: 'Oct', nov: 'Nov', dec: 'Dec',
};

export const MONTH_FULL_LABELS: Record<Month, string> = {
  mar: 'March', apr: 'April', may: 'May', jun: 'June', jul: 'July 1-4',
  aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December',
};

/** Map JS Date.getMonth() (0-indexed) to our Month key. Returns null for Jan/Feb. */
export function dateToMonth(date: Date): Month | null {
  const map: Record<number, Month> = {
    2: 'mar', 3: 'apr', 4: 'may', 5: 'jun', 6: 'jul',
    7: 'aug', 8: 'sep', 9: 'oct', 10: 'nov', 11: 'dec',
  };
  return map[date.getMonth()] ?? null;
}

/** Get the current Pro Forma month based on today's date */
export function getCurrentProFormaMonth(): Month | null {
  return dateToMonth(new Date());
}

/** Get all months up to and including the given month */
export function getMonthsThrough(month: Month): Month[] {
  const idx = MONTHS.indexOf(month);
  return idx >= 0 ? MONTHS.slice(0, idx + 1) : [];
}

// ---------------------------------------------------------------------------
// Unit Economics (per bag)
// ---------------------------------------------------------------------------

export const UNIT_ECONOMICS = {
  // LOCKED 2026-04-30 PM by Ben — Class C `pricing.change` v2.2 → v2.3 ratified.
  // See /CLAUDE.md "Inventory & COGS Model" + /contracts/wholesale-pricing.md §1.
  // Verified breakdown (all sources cited in wholesale-pricing.md §1):
  //   Albanese gummies   $1.037   (BoA outflow 2026-03-17 = $55,244.50)
  //   Belmark film       $0.131   (BoA outflow 2026-03-18 = $6,989.66)
  //   Powers labor+carts $0.376   (BoA outflow 2026-03-31 = $10,020.25)
  //   Factory subtotal   $1.544
  //   Uline secondary    $0.250   (master+inner+strip clip+S-hook = $8.84/MC ÷ 36 bags)
  //   ─────────────────────────────
  //   Operating COGS     $1.794 → $1.79/bag
  // Replaces the prior $1.77 lock (which understated factory by $0.024/bag, 1.4%).
  // Replaces the legacy $1.75 placeholder ("Albanese + Dutch Valley") from the v23 proforma build.
  // NOTE: the downstream gpPerUnit values below were calibrated against the old $1.75 COGS and are STALE.
  // Per /contracts/proforma-channel-margins.md the honest per-bag GM at $1.79 COGS comes lower than these numbers.
  // Rene to refresh in next pro-forma bump; canonical per-channel GM math lives in /contracts/proforma-channel-margins.md.
  cogsPerBag: 1.79,
  amazon: {
    retailPrice: 5.99,      // 7.5 oz bag MSRP
    fbaFees: 3.71,           // Referral + FBA fulfillment
    gpPerUnit: 0.53,         // STALE — calibrated against $1.75 COGS; honest GP at $1.79 ≈ $0.31 per /contracts/proforma-channel-margins.md §1.1
  },
  wholesale: {
    price: 3.49,             // Retailer wholesale
    gpPerUnit: 1.74,         // STALE — calibrated against $1.75 COGS; honest GP at $1.79 ≈ $1.70
  },
  distributor: {
    sellPrice: 2.50,         // Sold in 6-packs with display
    displayCostPerUnit: 0.33,
    gpPerUnit: 0.42,         // STALE — calibrated against $1.75 COGS; honest GP at $1.79 ≈ $0.38
  },
} as const;

// ---------------------------------------------------------------------------
// Loan Structure
// ---------------------------------------------------------------------------

export const LOAN = {
  principal: 300_000,
  flatReturnRate: 0.08,
  totalObligation: 324_000,
  totalInterest: 24_000,
  deferralMonths: 6,                // No repayment before Aug 2026
  monthlyRepaymentRate: 0.15,       // 15% of gross monthly revenue
  repaymentStartMonth: 'aug' as Month,
  projectedPayoffDate: 'Feb 2028',
  /** Each payment splits: 92.59% principal, 7.41% interest */
  principalRatio: 300_000 / 324_000,   // ≈ 0.92593
  interestRatio: 24_000 / 324_000,     // ≈ 0.07407
} as const;

// ---------------------------------------------------------------------------
// Channel Targets — Units
// ---------------------------------------------------------------------------

export const AMAZON: ChannelMetrics = {
  units: { mar: 100, apr: 250, may: 500, jun: 900, jul: 200, aug: 1000, sep: 1100, oct: 1200, nov: 1300, dec: 1400 },
  revenue: { mar: 599, apr: 1497.50, may: 2995, jun: 5391, jul: 1198, aug: 5990, sep: 6589, oct: 7188, nov: 7787, dec: 8386 },
  grossProfit: { mar: 53, apr: 132.50, may: 265, jun: 477, jul: 106, aug: 530, sep: 583, oct: 636, nov: 689, dec: 742 },
};

export const WHOLESALE: ChannelMetrics = {
  units: { mar: 400, apr: 1200, may: 2800, jun: 4000, jul: 800, aug: 4400, sep: 4800, oct: 5300, nov: 5800, dec: 6400 },
  revenue: { mar: 1396, apr: 4188, may: 9772, jun: 13960, jul: 2792, aug: 15356, sep: 16752, oct: 18497, nov: 20242, dec: 22336 },
  grossProfit: { mar: 696, apr: 2088, may: 4872, jun: 6960, jul: 1392, aug: 7656, sep: 8352, oct: 9222, nov: 10092, dec: 11136 },
};

export const DISTRIBUTOR: ChannelMetrics = {
  units: { mar: 0, apr: 0, may: 2000, jun: 5000, jul: 1500, aug: 7500, sep: 9000, oct: 11000, nov: 13500, dec: 15000 },
  revenue: { mar: 0, apr: 0, may: 5000, jun: 12500, jul: 3750, aug: 18750, sep: 22500, oct: 27500, nov: 33750, dec: 37500 },
  grossProfit: { mar: 0, apr: 0, may: 833.33, jun: 2083.33, jul: 625, aug: 3125, sep: 3750, oct: 4583.33, nov: 5625, dec: 6250 },
};

// ---------------------------------------------------------------------------
// Totals (all channels combined)
// ---------------------------------------------------------------------------

export const TOTAL_UNITS: MonthlyData = {
  mar: 500, apr: 1450, may: 5300, jun: 9900, jul: 2500, aug: 12900, sep: 14900, oct: 17500, nov: 20600, dec: 22800,
};

export const TOTAL_REVENUE: MonthlyData = {
  mar: 1995, apr: 5685.50, may: 17767, jun: 31851, jul: 7740, aug: 40096, sep: 45841, oct: 53185, nov: 61779, dec: 68222,
};

export const TOTAL_GROSS_PROFIT: MonthlyData = {
  mar: 749, apr: 2220.50, may: 5970.33, jun: 9520.33, jul: 2123, aug: 11311, sep: 12685, oct: 14441.33, nov: 16406, dec: 18128,
};

export const GROSS_MARGIN: MonthlyData = {
  mar: 0.3754, apr: 0.3906, may: 0.3360, jun: 0.2989, jul: 0.2743,
  aug: 0.2821, sep: 0.2767, oct: 0.2715, nov: 0.2656, dec: 0.2657,
};

// ---------------------------------------------------------------------------
// Operating Expenses (v23: now includes Contingency)
// ---------------------------------------------------------------------------

export const MARKETING: MonthlyData = {
  mar: 10500, apr: 10500, may: 9000, jun: 5000, jul: 3000, aug: 4010, sep: 4584, oct: 5319, nov: 6178, dec: 6822,
};

export const RENT_GA: MonthlyData = {
  mar: 2000, apr: 2000, may: 2000, jun: 2000, jul: 2000, aug: 2000, sep: 5000, oct: 5000, nov: 5000, dec: 5000,
};

/** v23 addition: $500/mo operational contingency buffer */
export const CONTINGENCY: MonthlyData = {
  mar: 500, apr: 500, may: 500, jun: 500, jul: 500, aug: 500, sep: 500, oct: 500, nov: 500, dec: 500,
};

export const ONE_TIME_SETUP: MonthlyData = {
  mar: 54300, apr: 0, may: 0, jun: 0, jul: 0, aug: 0, sep: 0, oct: 0, nov: 0, dec: 0,
};

/** Total OpEx = Marketing + Rent/G&A + Contingency + One-Time Setup */
export const TOTAL_OPEX: MonthlyData = {
  mar: 67300, apr: 13000, may: 11500, jun: 7500, jul: 5500, aug: 6510, sep: 10084, oct: 10819, nov: 11678, dec: 12322,
};

// ---------------------------------------------------------------------------
// EBITDA (GP minus full OpEx — corrected from v23 spreadsheet formula errors)
// ---------------------------------------------------------------------------

export const EBITDA: MonthlyData = {
  mar: -66551, apr: -10779.50, may: -5529.67, jun: 2020.33, jul: -3377,
  aug: 4801, sep: 2601, oct: 3622.33, nov: 4728, dec: 5806,
};

// ---------------------------------------------------------------------------
// Projected Cash Balance (simplified model: Cash = prev + GP − OpEx − Loan)
// ---------------------------------------------------------------------------

/** Monthly ending cash balance, starting from $300K loan proceeds */
export const PROJECTED_CASH: MonthlyData = {
  mar: 233449, apr: 222669.50, may: 217139.83, jun: 219160.16, jul: 215783.16,
  aug: 214569.76, sep: 210294.61, oct: 205939.19, nov: 201400.34, dec: 196973.05,
};

// ---------------------------------------------------------------------------
// Inventory at Cost ($1.75/unit — tracks 50K initial + 30K reorders in Aug/Nov)
// ---------------------------------------------------------------------------

export const INVENTORY_AT_COST: MonthlyData = {
  mar: 86625, apr: 84087.50, may: 74812.50, jun: 57487.50, jul: 53112.50,
  aug: 83037.50, sep: 56962.50, oct: 26337.50, nov: 42787.50, dec: 2887.50,
};

// ---------------------------------------------------------------------------
// Loan Repayment Schedule (total obligation: $324K)
// ---------------------------------------------------------------------------

export const LOAN_REPAYMENT: MonthlyData = {
  mar: 0, apr: 0, may: 0, jun: 0, jul: 0,
  aug: 6014.40, sep: 6876.15, oct: 7977.75, nov: 9266.85, dec: 10233.30,
};

export const LOAN_BALANCE: MonthlyData = {
  mar: 324000, apr: 324000, may: 324000, jun: 324000, jul: 324000,
  aug: 317985.60, sep: 311109.45, oct: 303131.70, nov: 293864.85, dec: 283631.55,
};

export const FULL_REPAYMENT_SCHEDULE: LoanMonth[] = [
  { month: 'Aug 2026', revenue: 40096, repayment: 6014.40, cumulativeRepaid: 6014.40, balanceRemaining: 317985.60 },
  { month: 'Sep 2026', revenue: 45841, repayment: 6876.15, cumulativeRepaid: 12890.55, balanceRemaining: 311109.45 },
  { month: 'Oct 2026', revenue: 53185, repayment: 7977.75, cumulativeRepaid: 20868.30, balanceRemaining: 303131.70 },
  { month: 'Nov 2026', revenue: 61779, repayment: 9266.85, cumulativeRepaid: 30135.15, balanceRemaining: 293864.85 },
  { month: 'Dec 2026', revenue: 68222, repayment: 10233.30, cumulativeRepaid: 40368.45, balanceRemaining: 283631.55 },
  { month: 'Jan 2027', revenue: 75044, repayment: 11256.60, cumulativeRepaid: 51625.05, balanceRemaining: 272374.95 },
  { month: 'Feb 2027', revenue: 82548, repayment: 12382.20, cumulativeRepaid: 64007.25, balanceRemaining: 259992.75 },
  { month: 'Mar 2027', revenue: 90803, repayment: 13620.45, cumulativeRepaid: 77627.70, balanceRemaining: 246372.30 },
  { month: 'Apr 2027', revenue: 99883, repayment: 14982.45, cumulativeRepaid: 92610.15, balanceRemaining: 231389.85 },
  { month: 'May 2027', revenue: 109871, repayment: 16480.65, cumulativeRepaid: 109090.80, balanceRemaining: 214909.20 },
  { month: 'Jun 2027', revenue: 120858, repayment: 18128.70, cumulativeRepaid: 127219.50, balanceRemaining: 196780.50 },
  { month: 'Jul 2027', revenue: 132944, repayment: 19941.60, cumulativeRepaid: 147161.10, balanceRemaining: 176838.90 },
  { month: 'Aug 2027', revenue: 146238, repayment: 21935.70, cumulativeRepaid: 169096.80, balanceRemaining: 154903.20 },
  { month: 'Sep 2027', revenue: 160862, repayment: 24129.30, cumulativeRepaid: 193226.10, balanceRemaining: 130773.90 },
  { month: 'Oct 2027', revenue: 176948, repayment: 26542.20, cumulativeRepaid: 219768.30, balanceRemaining: 104231.70 },
  { month: 'Nov 2027', revenue: 194643, repayment: 29196.45, cumulativeRepaid: 248964.75, balanceRemaining: 75035.25 },
  { month: 'Dec 2027', revenue: 214107, repayment: 32116.05, cumulativeRepaid: 281080.80, balanceRemaining: 42919.20 },
  { month: 'Jan 2028', revenue: 235518, repayment: 35327.70, cumulativeRepaid: 316408.50, balanceRemaining: 7591.50 },
  { month: 'Feb 2028', revenue: 259070, repayment: 7591.50, cumulativeRepaid: 324000, balanceRemaining: 0 },
];

// ---------------------------------------------------------------------------
// Loan Amortization — Principal / Interest Split (v23 addition)
// Each payment: 92.59% → principal, 7.41% → interest (flat $24K return)
// ---------------------------------------------------------------------------

export const AMORTIZATION_SCHEDULE: AmortizationMonth[] = [
  { month: 'Aug 2026', grossRevenue: 40096, totalPayment: 6014.40, principalPortion: 5568.89, interestPortion: 445.51, cumulativePrincipal: 5568.89, cumulativeInterest: 445.51, principalBalance: 294431.11 },
  { month: 'Sep 2026', grossRevenue: 45841, totalPayment: 6876.15, principalPortion: 6366.81, interestPortion: 509.34, cumulativePrincipal: 11935.69, cumulativeInterest: 954.86, principalBalance: 288064.31 },
  { month: 'Oct 2026', grossRevenue: 53185, totalPayment: 7977.75, principalPortion: 7386.81, interestPortion: 590.94, cumulativePrincipal: 19322.50, cumulativeInterest: 1545.80, principalBalance: 280677.50 },
  { month: 'Nov 2026', grossRevenue: 61779, totalPayment: 9266.85, principalPortion: 8580.42, interestPortion: 686.43, cumulativePrincipal: 27902.92, cumulativeInterest: 2232.23, principalBalance: 272097.08 },
  { month: 'Dec 2026', grossRevenue: 68222, totalPayment: 10233.30, principalPortion: 9475.28, interestPortion: 758.02, cumulativePrincipal: 37378.19, cumulativeInterest: 2990.26, principalBalance: 262621.81 },
  { month: 'Jan 2027', grossRevenue: 75044, totalPayment: 11256.60, principalPortion: 10422.78, interestPortion: 833.82, cumulativePrincipal: 47800.97, cumulativeInterest: 3824.08, principalBalance: 252199.03 },
  { month: 'Feb 2027', grossRevenue: 82548, totalPayment: 12382.20, principalPortion: 11465.00, interestPortion: 917.20, cumulativePrincipal: 59265.97, cumulativeInterest: 4741.28, principalBalance: 240734.03 },
  { month: 'Mar 2027', grossRevenue: 90803, totalPayment: 13620.45, principalPortion: 12611.53, interestPortion: 1008.92, cumulativePrincipal: 71877.50, cumulativeInterest: 5750.20, principalBalance: 228122.50 },
  { month: 'Apr 2027', grossRevenue: 99883, totalPayment: 14982.45, principalPortion: 13872.64, interestPortion: 1109.81, cumulativePrincipal: 85750.14, cumulativeInterest: 6860.01, principalBalance: 214249.86 },
  { month: 'May 2027', grossRevenue: 109871, totalPayment: 16480.65, principalPortion: 15259.86, interestPortion: 1220.79, cumulativePrincipal: 101010.00, cumulativeInterest: 8080.80, principalBalance: 198990.00 },
  { month: 'Jun 2027', grossRevenue: 120858, totalPayment: 18128.70, principalPortion: 16785.83, interestPortion: 1342.87, cumulativePrincipal: 117795.83, cumulativeInterest: 9423.67, principalBalance: 182204.17 },
  { month: 'Jul 2027', grossRevenue: 132944, totalPayment: 19941.60, principalPortion: 18464.44, interestPortion: 1477.16, cumulativePrincipal: 136260.28, cumulativeInterest: 10900.82, principalBalance: 163739.72 },
  { month: 'Aug 2027', grossRevenue: 146238, totalPayment: 21935.70, principalPortion: 20310.83, interestPortion: 1624.87, cumulativePrincipal: 156571.11, cumulativeInterest: 12525.69, principalBalance: 143428.89 },
  { month: 'Sep 2027', grossRevenue: 160862, totalPayment: 24129.30, principalPortion: 22341.94, interestPortion: 1787.36, cumulativePrincipal: 178913.06, cumulativeInterest: 14313.04, principalBalance: 121086.94 },
  { month: 'Oct 2027', grossRevenue: 176948, totalPayment: 26542.20, principalPortion: 24576.11, interestPortion: 1966.09, cumulativePrincipal: 203489.17, cumulativeInterest: 16279.13, principalBalance: 96510.83 },
  { month: 'Nov 2027', grossRevenue: 194643, totalPayment: 29196.45, principalPortion: 27033.75, interestPortion: 2162.70, cumulativePrincipal: 230522.92, cumulativeInterest: 18441.83, principalBalance: 69477.08 },
  { month: 'Dec 2027', grossRevenue: 214107, totalPayment: 32116.05, principalPortion: 29737.08, interestPortion: 2378.97, cumulativePrincipal: 260260.00, cumulativeInterest: 20820.80, principalBalance: 39740.00 },
  { month: 'Jan 2028', grossRevenue: 235518, totalPayment: 35327.70, principalPortion: 32710.83, interestPortion: 2616.87, cumulativePrincipal: 292970.83, cumulativeInterest: 23437.67, principalBalance: 7029.17 },
  { month: 'Feb 2028', grossRevenue: 259070, totalPayment: 7591.50, principalPortion: 7029.17, interestPortion: 562.33, cumulativePrincipal: 300000, cumulativeInterest: 24000, principalBalance: 0 },
];

// ---------------------------------------------------------------------------
// Capital Deployment
// ---------------------------------------------------------------------------

export const CAPITAL_DEPLOYMENT: CapitalLineItem[] = [
  { category: 'Inventory — 50K unit production run', amount: 87500, deployMonth: 'March', notes: 'COGS flows through GP' },
  { category: 'Display Contractor Loan', amount: 40000, deployMonth: 'March', notes: 'Brent Inderbitzin display program' },
  { category: 'Email Domain Rehab', amount: 4000, deployMonth: 'March', notes: 'Domain warm-up + DMARC/DKIM' },
  { category: 'Amazon Listing Consultant', amount: 5000, deployMonth: 'March', notes: 'A+ content optimization' },
  { category: 'Faire + B2B Setup', amount: 5000, deployMonth: 'March', notes: 'Platform fees, samples, onboarding' },
  { category: 'A+ Content + Listing Video', amount: 300, deployMonth: 'March', notes: 'Photography + video production' },
  { category: 'Amazon PPC — March', amount: 6000, deployMonth: 'March', notes: 'Launch spend' },
  { category: 'Amazon PPC — April', amount: 5000, deployMonth: 'April', notes: 'Optimization phase' },
  { category: 'Amazon PPC — May', amount: 4000, deployMonth: 'May', notes: 'Steady state' },
  { category: 'Google Ads Signal Testing — March', amount: 1500, deployMonth: 'March', notes: 'DTC demand signal' },
  { category: 'Google Ads Signal Testing — April', amount: 1500, deployMonth: 'April', notes: 'DTC demand signal' },
  { category: 'Road Sales — March', amount: 3000, deployMonth: 'March', notes: 'Ben travel + samples' },
  { category: 'Road Sales — April', amount: 4000, deployMonth: 'April', notes: 'Ben travel + samples' },
  { category: 'Road Sales — May', amount: 5000, deployMonth: 'May', notes: 'Ben travel + samples' },
  { category: 'Road Sales — June', amount: 5000, deployMonth: 'June', notes: 'Ben travel + samples' },
  { category: 'Road Sales — July', amount: 3000, deployMonth: 'July', notes: 'Ben travel + samples' },
  { category: 'Rent — March', amount: 2000, deployMonth: 'March', notes: '6-month lease' },
  { category: 'Rent — April', amount: 2000, deployMonth: 'April', notes: '6-month lease' },
  { category: 'Rent — May', amount: 2000, deployMonth: 'May', notes: '6-month lease' },
  { category: 'Rent — June', amount: 2000, deployMonth: 'June', notes: '6-month lease' },
  { category: 'Rent — July', amount: 2000, deployMonth: 'July', notes: '6-month lease' },
  { category: 'Rent — August', amount: 2000, deployMonth: 'August', notes: '6-month lease (final)' },
  { category: 'Working Capital Reserve', amount: 110200, deployMonth: '—', notes: 'Two 30K-unit reorders + $5K buffer' },
];

export const CAPITAL_BY_MONTH: Record<string, number> = {
  March: 154300,
  April: 12500,
  May: 11000,
  June: 7000,
  July: 5000,
  August: 2000,
  Reserve: 108200,
};

export const TOTAL_CAPITAL_DEPLOYED = 302000;

// ---------------------------------------------------------------------------
// Founder Capital To Date — Pre-Raise Spend (v23 addition)
// ---------------------------------------------------------------------------

export const CAPITAL_TO_DATE: CapitalToDateEntry[] = [
  { category: 'Office, Supplies & Equipment', amount: 5959, period: '2025', notes: 'Packaging, samples, production supplies, equipment' },
  { category: 'Professional Services', amount: 12063, period: '2025', notes: 'Legal, accounting, consulting, Amazon listing' },
  { category: 'Travel & Auto', amount: 658, period: '2025', notes: 'Trade shows, distributor meetings, samples delivery' },
  { category: 'Other / Misc', amount: 5209, period: '2025', notes: 'Insurance, software, misc operating' },
  { category: 'COGS (initial product runs)', amount: 7780, period: '2025', notes: 'Test production runs, packaging trials' },
  { category: 'Office & Supplies', amount: 1373, period: 'Jan-Feb 2026', notes: 'Continued product dev, packaging' },
  { category: 'Professional Services', amount: 642, period: 'Jan-Feb 2026', notes: 'Legal, compliance' },
  { category: 'Travel', amount: 150, period: 'Jan-Feb 2026', notes: 'Distributor outreach' },
  { category: 'Other / Misc', amount: 684, period: 'Jan-Feb 2026', notes: 'Software, misc ops' },
];

export const FOUNDER_CAPITAL_2025 = 31669;
export const FOUNDER_CAPITAL_2026_YTD = 2849;
export const FOUNDER_CAPITAL_TOTAL = 31819; // Per Summary tab (investor headline figure)

// ---------------------------------------------------------------------------
// Distributor Network Plan
// ---------------------------------------------------------------------------

export const DISTRIBUTOR_RAMP = [1500, 3000, 5000, 6000, 6000]; // units/month, per distributor

export const DISTRIBUTOR_NETWORK = [
  { id: 1, name: 'Brent Inderbitzin', startMonth: 'may' as Month, status: 'confirmed', territory: 'TBD' },
  { id: 2, name: 'Distributor #2', startMonth: 'aug' as Month, status: 'prospecting', territory: 'TBD' },
  { id: 3, name: 'Distributor #3', startMonth: 'nov' as Month, status: 'planned', territory: 'TBD' },
  { id: 4, name: 'Distributor #4', startMonth: 'Q1 2027', status: 'planned', territory: 'TBD' },
];

// ---------------------------------------------------------------------------
// Inventory Plan
// ---------------------------------------------------------------------------

export const INVENTORY_PLAN = [
  { run: 'Initial', units: 50000, month: 'March', fundingSource: 'Loan proceeds' },
  { run: 'Reorder #1', units: 30000, month: '~August', fundingSource: 'Working Capital Reserve' },
  { run: 'Reorder #2', units: 30000, month: '~November', fundingSource: 'Working Capital Reserve' },
];

// ---------------------------------------------------------------------------
// Annual Summary (2026) — v23 corrected
// ---------------------------------------------------------------------------

export const ANNUAL_SUMMARY = {
  totalUnits: 108350,
  totalRevenue: 334161.50,
  totalGrossProfit: 93554.50,
  blendedGrossMargin: 0.28,
  totalOpex: 156213,
  ebitda: -62658.50,
  totalLoanRepayment2026: 40368.45,
  netIncome: -103026.95,
  closingCashDec31: 196973.05,
  loanBalanceDec31: 283631.55,
  /** v23 addition: total pre-raise founder spend */
  founderCapitalDeployed: 31819,
  /** v23 addition: annualized contingency */
  totalContingency: 5000,
} as const;

// ---------------------------------------------------------------------------
// Key Milestones
// ---------------------------------------------------------------------------

export const MILESTONES: Milestone[] = [
  { id: 'ebitda-positive', label: 'EBITDA Positive', targetMonth: 'jun', metric: 'ebitda', threshold: 0, unit: 'dollars' },
  { id: 'first-distributor', label: 'Distributor #1 Live', targetMonth: 'may', metric: 'distributor_units', threshold: 1, unit: 'units' },
  { id: 'second-distributor', label: 'Distributor #2 Live', targetMonth: 'aug', metric: 'distributor_units', threshold: 7500, unit: 'units' },
  { id: 'third-distributor', label: 'Distributor #3 Live', targetMonth: 'nov', metric: 'distributor_units', threshold: 13500, unit: 'units' },
  { id: 'first-reorder', label: '1st Inventory Reorder', targetMonth: 'aug', metric: 'reorder', threshold: 30000, unit: 'units' },
  { id: 'second-reorder', label: '2nd Inventory Reorder', targetMonth: 'nov', metric: 'reorder', threshold: 30000, unit: 'units' },
  { id: 'loan-repayment-start', label: 'Loan Repayment Begins', targetMonth: 'aug', metric: 'loan_payment', threshold: 6014.40, unit: 'dollars' },
  { id: 'cash-floor', label: 'Cash Never Below $195K', targetMonth: 'dec', metric: 'cash', threshold: 195000, unit: 'dollars' },
  { id: '100k-units', label: '100K+ Units Sold', targetMonth: 'dec', metric: 'cumulative_units', threshold: 100000, unit: 'units' },
  { id: 'loan-payoff', label: 'Full Loan Repayment', targetMonth: 'Feb 2028', metric: 'loan_balance', threshold: 0, unit: 'dollars' },
];

// ---------------------------------------------------------------------------
// Utility: compute cumulative values through a given month
// ---------------------------------------------------------------------------

export function cumulativeThrough(data: MonthlyData, month: Month): number {
  return getMonthsThrough(month).reduce((sum, m) => sum + data[m], 0);
}

/** Get a plan-vs-actual comparison for a given month */
export function planVsActual(planned: number, actual: number) {
  const variance = actual - planned;
  const variancePct = planned !== 0 ? variance / planned : 0;
  const status: 'ahead' | 'on-track' | 'behind' | 'critical' =
    variancePct >= 0.05 ? 'ahead' :
    variancePct >= -0.1 ? 'on-track' :
    variancePct >= -0.3 ? 'behind' : 'critical';
  return { planned, actual, variance, variancePct, status };
}
