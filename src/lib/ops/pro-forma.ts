/**
 * USA Gummies — Pro Forma v22 | Full Year 2026
 *
 * All financial targets, unit projections, and KPI benchmarks
 * extracted from USA_Gummies_Pro_Forma_2026_v22.xlsx
 *
 * This is the SINGLE SOURCE OF TRUTH for plan-vs-actual comparison
 * across the entire War Room dashboard.
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
  cogsPerBag: 1.75,         // Albanese + Dutch Valley, 50K unit run
  amazon: {
    retailPrice: 5.99,      // 7.5 oz bag MSRP
    fbaFees: 3.71,           // Referral + FBA fulfillment
    gpPerUnit: 0.53,
  },
  wholesale: {
    price: 3.49,             // Retailer wholesale
    gpPerUnit: 1.74,
  },
  distributor: {
    sellPrice: 2.50,         // Sold in 6-packs with display
    displayCostPerUnit: 0.33,
    gpPerUnit: 0.42,
  },
} as const;

// ---------------------------------------------------------------------------
// Loan Structure
// ---------------------------------------------------------------------------

export const LOAN = {
  principal: 300_000,
  flatReturnRate: 0.08,
  totalObligation: 324_000,
  deferralMonths: 6,                // No repayment before Aug 2026
  monthlyRepaymentRate: 0.15,       // 15% of gross monthly revenue
  repaymentStartMonth: 'aug' as Month,
  projectedPayoffDate: 'Feb 2028',
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
// Operating Expenses
// ---------------------------------------------------------------------------

export const MARKETING: MonthlyData = {
  mar: 10500, apr: 10500, may: 9000, jun: 5000, jul: 3000, aug: 4010, sep: 4584, oct: 5319, nov: 6178, dec: 6822,
};

export const RENT_GA: MonthlyData = {
  mar: 2000, apr: 2000, may: 2000, jun: 2000, jul: 2000, aug: 2000, sep: 5000, oct: 5000, nov: 5000, dec: 5000,
};

export const ONE_TIME_SETUP: MonthlyData = {
  mar: 54300, apr: 0, may: 0, jun: 0, jul: 0, aug: 0, sep: 0, oct: 0, nov: 0, dec: 0,
};

export const TOTAL_OPEX: MonthlyData = {
  mar: 66800, apr: 12500, may: 11000, jun: 7000, jul: 5000, aug: 6010, sep: 9584, oct: 10319, nov: 11178, dec: 11822,
};

// ---------------------------------------------------------------------------
// EBITDA
// ---------------------------------------------------------------------------

export const EBITDA: MonthlyData = {
  mar: -66051, apr: -10279.50, may: -5029.67, jun: 2520.33, jul: -2877,
  aug: 5301, sep: 3101, oct: 4122.33, nov: 5228, dec: 6306,
};

// ---------------------------------------------------------------------------
// Loan Repayment Schedule
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
// Annual Summary (2026)
// ---------------------------------------------------------------------------

export const ANNUAL_SUMMARY = {
  totalUnits: 108350,
  totalRevenue: 334161.50,
  totalGrossProfit: 93554.50,
  blendedGrossMargin: 0.28,
  totalOpex: 151213,
  ebitda: -57658.50,
  totalLoanRepayment2026: 40368.45,
  netIncome: -98026.95,
  closingCashDec31: 201973.05,
  loanBalanceDec31: 283631.55,
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
  { id: 'cash-floor', label: 'Cash Never Below $200K', targetMonth: 'dec', metric: 'cash', threshold: 200000, unit: 'dollars' },
  { id: '100k-units', label: '100K+ Units Sold', targetMonth: 'dec', metric: 'cumulative_units', threshold: 100000, unit: 'units' },
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
