import { NextResponse } from "next/server";
import { readState, writeState } from "@/lib/ops/state";
import type { CacheEnvelope } from "@/lib/amazon/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL = 15 * 60 * 1000;

type ShopifyMoney = { amount: string; currencyCode?: string };

type CustomerNode = {
  id: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  numberOfOrders: number;
  amountSpent: ShopifyMoney | null;
  createdAt: string;
  lastOrder: { createdAt: string; totalPriceSet: { shopMoney: ShopifyMoney } } | null;
  defaultAddress: {
    provinceCode: string | null;
    countryCodeV2: string | null;
    city: string | null;
  } | null;
  orders: {
    edges: Array<{ node: { createdAt: string } }>;
  };
};

type OrderNode = {
  id: string;
  createdAt: string;
  totalPriceSet: { shopMoney: ShopifyMoney };
  customer: { id: string | null } | null;
};

type CustomerMetric = {
  id: string;
  name: string;
  email: string;
  totalSpent: number;
  ordersCount: number;
  avgOrderValue: number;
  lastOrderAt: string | null;
  state: string;
};

type RetentionRow = {
  cohort: string;
  cohortLabel: string;
  size: number;
  retention: number[];
};

type CustomersResponse = {
  summary: {
    totalCustomers: number;
    repeatRate: number;
    avgLtv: number;
    aov: number;
    orders90d: number;
  };
  ltvDistribution: Array<{ bucket: string; count: number; pct: number }>;
  orderFrequency: Array<{ bucket: string; count: number; pct: number }>;
  cohortRetention: {
    months: string[];
    rows: RetentionRow[];
  };
  topCustomers: CustomerMetric[];
  geography: Array<{ state: string; count: number; pct: number }>;
  generatedAt: string;
  error?: string;
};

function shopifyToken(): string {
  return process.env.SHOPIFY_ADMIN_TOKEN || "";
}

function shopifyDomain(): string {
  return (
    process.env.SHOPIFY_STORE_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    ""
  )
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

function isShopifyConfigured(): boolean {
  return !!(shopifyToken() && shopifyDomain());
}

async function shopifyGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${shopifyDomain()}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": shopifyToken(),
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify GraphQL failed (${res.status}): ${body.slice(0, 220)}`);
  }

  const json = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message || "GraphQL error").join("; "));
  }
  if (!json.data) {
    throw new Error("Shopify GraphQL returned no data");
  }

  return json.data;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function monthLabel(key: string): string {
  const d = new Date(`${key}-01T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function addMonths(key: string, months: number): string {
  const [year, month] = key.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + months, 1, 12, 0, 0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function ltvBucket(value: number): string {
  if (value <= 25) return "$0-25";
  if (value <= 50) return "$25-50";
  if (value <= 100) return "$50-100";
  if (value <= 200) return "$100-200";
  return "$200+";
}

function orderFreqBucket(orders: number): string {
  if (orders <= 1) return "1";
  if (orders <= 3) return "2-3";
  if (orders <= 5) return "4-5";
  return "6+";
}

function percentage(part: number, total: number): number {
  if (!total) return 0;
  return round2((part / total) * 100);
}

async function fetchCustomers(): Promise<CustomerNode[]> {
  const query = `
    query Customers($first: Int!) {
      customers(first: $first, sortKey: ORDERS_COUNT, reverse: true) {
        edges {
          node {
            id
            displayName
            firstName
            lastName
            email
            numberOfOrders
            amountSpent { amount currencyCode }
            createdAt
            lastOrder {
              createdAt
              totalPriceSet { shopMoney { amount currencyCode } }
            }
            defaultAddress { provinceCode countryCodeV2 city }
            orders(first: 50, sortKey: CREATED_AT, reverse: false) {
              edges { node { createdAt } }
            }
          }
        }
      }
    }
  `;

  const data = await shopifyGraphQL<{
    customers: { edges: Array<{ node: CustomerNode }> };
  }>(query, { first: 250 });

  return data.customers.edges.map((edge) => edge.node);
}

async function fetchOrders90d(): Promise<OrderNode[]> {
  const start = new Date();
  start.setDate(start.getDate() - 90);
  const queryFilter = `created_at:>=${start.toISOString().slice(0, 10)}`;

  const query = `
    query Orders($first: Int!, $query: String!) {
      orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            createdAt
            totalPriceSet { shopMoney { amount currencyCode } }
            customer { id }
          }
        }
      }
    }
  `;

  const data = await shopifyGraphQL<{
    orders: { edges: Array<{ node: OrderNode }> };
  }>(query, { first: 250, query: queryFilter });

  return data.orders.edges.map((edge) => edge.node);
}

function buildRetention(customers: CustomerNode[]): CustomersResponse["cohortRetention"] {
  const byCohort = new Map<string, Array<{ orderMonths: Set<string> }>>();

  for (const customer of customers) {
    const cohort = monthKey(customer.createdAt);
    const orderMonths = new Set<string>();
    orderMonths.add(cohort);

    for (const edge of customer.orders.edges || []) {
      const createdAt = edge.node?.createdAt;
      if (createdAt) orderMonths.add(monthKey(createdAt));
    }

    if (!byCohort.has(cohort)) byCohort.set(cohort, []);
    byCohort.get(cohort)?.push({ orderMonths });
  }

  const cohortKeys = Array.from(byCohort.keys()).sort().reverse().slice(0, 6);
  const months = ["M0", "M1", "M2", "M3", "M4", "M5"];

  const rows: RetentionRow[] = cohortKeys.map((cohort) => {
    const cohortCustomers = byCohort.get(cohort) || [];
    const size = cohortCustomers.length;

    const retention = months.map((_, idx) => {
      const targetMonth = addMonths(cohort, idx);
      const retained = cohortCustomers.filter((c) => c.orderMonths.has(targetMonth)).length;
      return percentage(retained, size);
    });

    return {
      cohort,
      cohortLabel: monthLabel(cohort),
      size,
      retention,
    };
  });

  return { months, rows };
}

function buildGeography(customers: CustomerNode[]): CustomersResponse["geography"] {
  const counts = new Map<string, number>();

  for (const customer of customers) {
    const address = customer.defaultAddress;
    const isUS = !address?.countryCodeV2 || address.countryCodeV2 === "US";
    if (!isUS) continue;
    const state = address?.provinceCode || "Unknown";
    counts.set(state, (counts.get(state) || 0) + 1);
  }

  const total = customers.length || 1;
  return Array.from(counts.entries())
    .map(([state, count]) => ({ state, count, pct: percentage(count, total) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function emptyResponse(error?: string): CustomersResponse {
  return {
    summary: {
      totalCustomers: 0,
      repeatRate: 0,
      avgLtv: 0,
      aov: 0,
      orders90d: 0,
    },
    ltvDistribution: [
      { bucket: "$0-25", count: 0, pct: 0 },
      { bucket: "$25-50", count: 0, pct: 0 },
      { bucket: "$50-100", count: 0, pct: 0 },
      { bucket: "$100-200", count: 0, pct: 0 },
      { bucket: "$200+", count: 0, pct: 0 },
    ],
    orderFrequency: [
      { bucket: "1", count: 0, pct: 0 },
      { bucket: "2-3", count: 0, pct: 0 },
      { bucket: "4-5", count: 0, pct: 0 },
      { bucket: "6+", count: 0, pct: 0 },
    ],
    cohortRetention: {
      months: ["M0", "M1", "M2", "M3", "M4", "M5"],
      rows: [],
    },
    topCustomers: [],
    geography: [],
    generatedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
  };
}

export async function GET(req: Request) {
  if (!isShopifyConfigured()) {
    return NextResponse.json(emptyResponse("Shopify Admin API not configured"));
  }

  const force = new URL(req.url).searchParams.get("force") === "1";
  const cached = await readState<CacheEnvelope<CustomersResponse> | null>("customers-cache", null);
  if (!force && cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    const [customers, orders90d] = await Promise.all([fetchCustomers(), fetchOrders90d()]);

    const customerMetrics: CustomerMetric[] = customers.map((customer) => {
      const first = customer.firstName || "";
      const last = customer.lastName || "";
      const fallbackName = [first, last].join(" ").trim();
      const name = customer.displayName || fallbackName || customer.email || "Customer";
      const totalSpent = Number(customer.amountSpent?.amount || 0);
      const ordersCount = Number(customer.numberOfOrders || 0);
      return {
        id: customer.id,
        name,
        email: customer.email || "",
        totalSpent: round2(totalSpent),
        ordersCount,
        avgOrderValue: ordersCount > 0 ? round2(totalSpent / ordersCount) : 0,
        lastOrderAt: customer.lastOrder?.createdAt || null,
        state: customer.defaultAddress?.provinceCode || "Unknown",
      };
    });

    const totalCustomers = customerMetrics.length;
    const repeatCustomers = customerMetrics.filter((c) => c.ordersCount > 1).length;
    const totalLtv = customerMetrics.reduce((sum, c) => sum + c.totalSpent, 0);
    const totalOrders90d = orders90d.length;
    const totalRevenue90d = orders90d.reduce(
      (sum, order) => sum + Number(order.totalPriceSet?.shopMoney?.amount || 0),
      0,
    );

    const ltvBuckets = ["$0-25", "$25-50", "$50-100", "$100-200", "$200+"];
    const ltvCounts = new Map<string, number>(ltvBuckets.map((bucket) => [bucket, 0]));
    for (const customer of customerMetrics) {
      const bucket = ltvBucket(customer.totalSpent);
      ltvCounts.set(bucket, (ltvCounts.get(bucket) || 0) + 1);
    }

    const orderFreqBuckets = ["1", "2-3", "4-5", "6+"];
    const orderFreqCounts = new Map<string, number>(orderFreqBuckets.map((bucket) => [bucket, 0]));
    for (const customer of customerMetrics) {
      const bucket = orderFreqBucket(customer.ordersCount);
      orderFreqCounts.set(bucket, (orderFreqCounts.get(bucket) || 0) + 1);
    }

    const result: CustomersResponse = {
      summary: {
        totalCustomers,
        repeatRate: percentage(repeatCustomers, totalCustomers),
        avgLtv: totalCustomers > 0 ? round2(totalLtv / totalCustomers) : 0,
        aov: totalOrders90d > 0 ? round2(totalRevenue90d / totalOrders90d) : 0,
        orders90d: totalOrders90d,
      },
      ltvDistribution: ltvBuckets.map((bucket) => {
        const count = ltvCounts.get(bucket) || 0;
        return { bucket, count, pct: percentage(count, totalCustomers) };
      }),
      orderFrequency: orderFreqBuckets.map((bucket) => {
        const count = orderFreqCounts.get(bucket) || 0;
        return { bucket, count, pct: percentage(count, totalCustomers) };
      }),
      cohortRetention: buildRetention(customers),
      topCustomers: customerMetrics
        .sort((a, b) => b.totalSpent - a.totalSpent)
        .slice(0, 10),
      geography: buildGeography(customers),
      generatedAt: new Date().toISOString(),
    };

    await writeState("customers-cache", {
      data: result,
      cachedAt: Date.now(),
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[marketing/customers] GET failed:", message);
    return NextResponse.json(emptyResponse(message), { status: 500 });
  }
}
