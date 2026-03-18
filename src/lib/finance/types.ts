/**
 * Financial types for the enterprise command center.
 *
 * Covers: Plaid banking, Shopify Payments, Amazon settlements,
 * AP/AR forecasting, and P&L reporting.
 */

// ---------------------------------------------------------------------------
// Plaid / Banking
// ---------------------------------------------------------------------------

export type PlaidAccount = {
  accountId: string;
  name: string;
  officialName: string | null;
  type: string; // "depository" | "credit" | "loan" | "investment"
  subtype: string | null;
  balances: {
    available: number | null;
    current: number | null;
    limit: number | null;
    currency: string;
  };
};

export type PlaidTransaction = {
  transactionId: string;
  date: string; // YYYY-MM-DD
  name: string;
  amount: number; // positive = debit (expense), negative = credit (income) in Plaid convention
  category: string[];
  pending: boolean;
  merchantName: string | null;
};

// ---------------------------------------------------------------------------
// Shopify Payments
// ---------------------------------------------------------------------------

export type ShopifyPaymentsBalance = {
  balance: number;
  currency: string;
  pendingPayouts: {
    amount: number;
    expectedDate: string | null;
  }[];
  lastPayout: {
    amount: number;
    date: string;
    status: string;
  } | null;
};

// ---------------------------------------------------------------------------
// Amazon Finances (Settlements)
// ---------------------------------------------------------------------------

export type AmazonFinancialEventGroup = {
  financialEventGroupId: string;
  processingStatus: string;
  fundTransferStatus: string;
  originalTotal: { CurrencyCode: string; CurrencyAmount: number } | null;
  convertedTotal: { CurrencyCode: string; CurrencyAmount: number } | null;
  fundTransferDate: string | null;
  traceId: string | null;
  accountTail: string | null;
  beginningBalance: { CurrencyCode: string; CurrencyAmount: number } | null;
  financialEventGroupStart: string | null;
  financialEventGroupEnd: string | null;
};

export type AmazonFinancials = {
  pendingBalance: number;
  lastSettlement: {
    amount: number;
    date: string;
    status: string;
  } | null;
  nextSettlementEstimate: {
    estimatedAmount: number;
    estimatedDate: string;
  } | null;
  recentEventGroups: AmazonFinancialEventGroup[];
};

// ---------------------------------------------------------------------------
// Unified Balance
// ---------------------------------------------------------------------------

export type UnifiedBalances = {
  found: {
    balance: number;
    available: number;
    lastUpdated: string;
    recentTransactions: PlaidTransaction[];
  } | null;
  shopify: ShopifyPaymentsBalance | null;
  amazon: AmazonFinancials | null;
  totalCash: number;
  lastUpdated: string;
};

// ---------------------------------------------------------------------------
// AP/AR Forecasting
// ---------------------------------------------------------------------------

export type Receivable = {
  source: "amazon_settlement" | "shopify_payout" | "b2b_invoice" | "other";
  amount: number;
  expectedDate: string; // ISO date
  confidence: "high" | "medium" | "low";
  description: string;
};

export type Payable = {
  category: "cogs" | "shipping" | "software" | "marketing" | "payroll" | "other";
  amount: number;
  dueDate: string;
  recurring: boolean;
  description: string;
};

export type CashFlowProjection = {
  date: string;
  openingBalance: number;
  inflows: number;
  outflows: number;
  closingBalance: number;
  receivables: Receivable[];
  payables: Payable[];
};

export type ForecastReport = {
  currentBalance: number;
  cashSource: "plaid" | "estimated" | "none";
  projections: {
    "30d": CashFlowProjection[];
    "60d": CashFlowProjection[];
    "90d": CashFlowProjection[];
  };
  alerts: string[];
  runway: number; // days until cash hits $0 at current burn rate
  generatedAt: string;
};

// ---------------------------------------------------------------------------
// P&L Reporting
// ---------------------------------------------------------------------------

export type PnLReport = {
  period: { start: string; end: string; label: string };
  revenue: {
    amazon: number;
    shopify: number;
    wholesale: number;
    total: number;
  };
  cogs: {
    productCost: number;
    shipping: number;
    amazonFees: number;
    shopifyFees: number;
    total: number;
  };
  grossProfit: number;
  grossMargin: number;
  opex: {
    software: number;
    marketing: number;
    payroll: number;
    other: number;
    total: number;
  };
  netIncome: number;
  netMargin: number;
  generatedAt: string;
};
