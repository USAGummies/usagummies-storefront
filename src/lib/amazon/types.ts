/**
 * Amazon SP-API types for the USA Gummies unified dashboard.
 *
 * Covers Orders, FBA Inventory, Fees, and the aggregated KPI payload.
 */

// ---------------------------------------------------------------------------
// SP-API Order types
// ---------------------------------------------------------------------------

export type AmazonOrderStatus =
  | "Pending"
  | "Unshipped"
  | "PartiallyShipped"
  | "Shipped"
  | "Canceled"
  | "Unfulfillable"
  | "InvoiceUnconfirmed"
  | "PendingAvailability";

export type AmazonMoney = {
  CurrencyCode: string;
  Amount: string;
};

export type AmazonOrder = {
  AmazonOrderId: string;
  PurchaseDate: string;
  LastUpdateDate: string;
  OrderStatus: AmazonOrderStatus;
  OrderTotal?: AmazonMoney;
  NumberOfItemsShipped?: number;
  NumberOfItemsUnshipped?: number;
  FulfillmentChannel?: "AFN" | "MFN"; // AFN = FBA, MFN = Merchant
  SalesChannel?: string;
  MarketplaceId?: string;
};

export type AmazonOrderItem = {
  ASIN: string;
  OrderItemId: string;
  SellerSKU?: string;
  Title?: string;
  QuantityOrdered: number;
  QuantityShipped: number;
  ItemPrice?: AmazonMoney;
  ItemTax?: AmazonMoney;
  PromotionDiscount?: AmazonMoney;
};

// ---------------------------------------------------------------------------
// FBA Inventory types
// ---------------------------------------------------------------------------

export type FBAInventorySummary = {
  asin: string;
  fnSku: string;
  sellerSku: string;
  condition: string;
  inventoryDetails: {
    fulfillableQuantity: number;
    inboundWorkingQuantity: number;
    inboundShippedQuantity: number;
    inboundReceivingQuantity: number;
    reservedQuantity: {
      totalReservedQuantity: number;
      pendingCustomerOrderQuantity: number;
      pendingTransshipmentQuantity: number;
      fcProcessingQuantity: number;
    };
    unfulfillableQuantity: {
      totalUnfulfillableQuantity: number;
      customerDamagedQuantity: number;
      warehouseDamagedQuantity: number;
      distributorDamagedQuantity: number;
      carrierDamagedQuantity: number;
      defectiveQuantity: number;
      expiredQuantity: number;
    };
  };
  lastUpdatedTime: string;
  productName: string;
  totalQuantity: number;
};

// ---------------------------------------------------------------------------
// Fee Estimate types
// ---------------------------------------------------------------------------

export type FeeEstimate = {
  referralFee: number;
  fbaFee: number;
  closingFee: number;
  totalFee: number;
  /** Net revenue per unit after fees */
  netPerUnit: number;
};

// ---------------------------------------------------------------------------
// Daily breakdown for charts
// ---------------------------------------------------------------------------

export type DailyDataPoint = {
  date: string; // YYYY-MM-DD
  label: string; // "Feb 1", "Feb 2" etc
  revenue: number;
  orders: number;
};

// ---------------------------------------------------------------------------
// Aggregated KPI payload (what the API route returns)
// ---------------------------------------------------------------------------

export type PeriodMetrics = {
  orders: number;
  revenue: number;
  unitsSold: number;
};

export type AmazonKPIs = {
  orders: {
    today: number;
    yesterday: number;
    weekToDate: number;
    lastWeek: number;
    monthToDate: number;
  };
  revenue: {
    today: number;
    yesterday: number;
    weekToDate: number;
    lastWeek: number;
    monthToDate: number;
  };
  aov: {
    today: number;
    weekToDate: number;
  };
  unitsSold: {
    today: number;
    weekToDate: number;
    monthToDate: number;
  };
  orderStatus: {
    pending: number;
    unshipped: number;
    shipped: number;
    canceled: number;
  };
  inventory: {
    fulfillable: number;
    inboundWorking: number;
    inboundShipped: number;
    reserved: number;
    unfulfillable: number;
    totalQuantity: number;
    daysOfSupply: number;
    restockAlert: boolean;
  };
  fees: {
    referralFee: number;
    fbaFee: number;
    totalFee: number;
    estimatedNetMargin: number;
  };
  velocity: {
    unitsPerDay7d: number;
    trend: "up" | "down" | "flat";
  };
  comparison: {
    todayVsYesterday: {
      revenueDelta: number;
      revenuePct: number;
      ordersDelta: number;
      ordersPct: number;
    };
    weekOverWeek: {
      revenueDelta: number;
      revenuePct: number;
      ordersDelta: number;
      ordersPct: number;
    };
  };
  /** Daily breakdown for charts (last 30 days) */
  dailyBreakdown: DailyDataPoint[];
  lastUpdated: string;
};

// ---------------------------------------------------------------------------
// Unified dashboard payload (Shopify + Amazon combined)
// ---------------------------------------------------------------------------

export type ShopifyKPIs = {
  totalOrders: number;
  totalRevenue: number;
  avgOrderValue: number;
  recentOrders: {
    name: string;
    createdAt: string;
    financialStatus: string;
    total: string;
  }[];
  /** Daily breakdown for charts */
  dailyBreakdown: DailyDataPoint[];
};

export type UnifiedDashboard = {
  combined: {
    totalRevenue: number;
    totalOrders: number;
    avgOrderValue: number;
  };
  shopify: ShopifyKPIs | null;
  amazon: AmazonKPIs | null;
  /** Merged daily breakdown (combined channels) for the main chart */
  chartData: {
    date: string;
    label: string;
    amazon: number;
    shopify: number;
    combined: number;
    amazonOrders: number;
    shopifyOrders: number;
    combinedOrders: number;
  }[];
  generatedAt: string;
};

// ---------------------------------------------------------------------------
// Financial Event Groups (Settlements)
// ---------------------------------------------------------------------------

export type FinancialEventGroup = {
  FinancialEventGroupId: string;
  ProcessingStatus: string;
  FundTransferStatus: string;
  OriginalTotal?: { CurrencyCode: string; CurrencyAmount: number };
  ConvertedTotal?: { CurrencyCode: string; CurrencyAmount: number };
  FundTransferDate?: string;
  TraceId?: string;
  AccountTail?: string;
  BeginningBalance?: { CurrencyCode: string; CurrencyAmount: number };
  FinancialEventGroupStart?: string;
  FinancialEventGroupEnd?: string;
};

// ---------------------------------------------------------------------------
// Cache envelope
// ---------------------------------------------------------------------------

export type CacheEnvelope<T> = {
  data: T;
  cachedAt: number; // epoch ms
};

// ---------------------------------------------------------------------------
// Cash & Finance types (Found.com banking integration)
// ---------------------------------------------------------------------------

export type CashTransaction = {
  id?: string; // Notion page ID (when reading from Notion)
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // positive = income, negative = expense
  category: "Income" | "Expense" | "Transfer" | "Refund";
  channel:
    | "Shopify"
    | "Amazon"
    | "Wholesale"
    | "Found Transfer"
    | "Other";
  balanceAfter?: number;
  source: "CSV Upload" | "Manual" | "Auto Sync";
};

export type CashPosition = {
  balance: number;
  lastUpdated: string; // ISO timestamp
  recentTransactions: CashTransaction[];
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyNet: number;
};
