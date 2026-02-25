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
};

export type UnifiedDashboard = {
  combined: {
    totalRevenue: number;
    totalOrders: number;
    avgOrderValue: number;
  };
  shopify: ShopifyKPIs | null;
  amazon: AmazonKPIs | null;
  generatedAt: string;
};

// ---------------------------------------------------------------------------
// Cache envelope
// ---------------------------------------------------------------------------

export type CacheEnvelope<T> = {
  data: T;
  cachedAt: number; // epoch ms
};
