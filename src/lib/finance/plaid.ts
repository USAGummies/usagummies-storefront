/**
 * Plaid Integration — USA Gummies
 *
 * Connects to Found.com banking via Plaid Link for real-time balance
 * and transaction data. Found has no direct API, so Plaid is the bridge.
 * Uses Production secret for both development and production environments.
 *
 * Flow:
 *   1. createLinkToken() → frontend shows Plaid Link UI
 *   2. exchangePublicToken() → stores access_token in KV
 *   3. getBalances() / getTransactions() → reads from Plaid using stored token
 *
 * Env vars: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV
 */

import { readState, writeState } from "@/lib/ops/state";
import type { PlaidAccount, PlaidTransaction } from "./types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PLAID_CLIENT_ID = () => process.env.PLAID_CLIENT_ID || "";
const PLAID_SECRET = () => process.env.PLAID_SECRET || "";
const PLAID_ENV = () => (process.env.PLAID_ENV || "sandbox") as "sandbox" | "development" | "production";

function plaidBaseUrl(): string {
  const env = PLAID_ENV();
  // Plaid "development" env uses the production API endpoint (not a separate host)
  if (env === "production" || env === "development") return "https://production.plaid.com";
  return "https://sandbox.plaid.com";
}

/** Return the Plaid env string (needed by Plaid Link on the frontend) */
export function getPlaidEnv(): "sandbox" | "development" | "production" {
  return PLAID_ENV();
}

export function isPlaidConfigured(): boolean {
  return !!(PLAID_CLIENT_ID() && PLAID_SECRET());
}

// ---------------------------------------------------------------------------
// Plaid API helpers
// ---------------------------------------------------------------------------

async function plaidPost<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${plaidBaseUrl()}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: PLAID_CLIENT_ID(),
      secret: PLAID_SECRET(),
      ...body,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Plaid ${endpoint} failed: ${res.status} — ${text}`);
  }

  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Link Token (Step 1 — frontend shows Plaid Link)
// ---------------------------------------------------------------------------

type LinkTokenResponse = {
  link_token: string;
  expiration: string;
  request_id: string;
};

export async function createLinkToken(): Promise<string> {
  const webhookUrl =
    process.env.PLAID_WEBHOOK_URL ||
    `${process.env.NEXT_PUBLIC_BASE_URL || "https://usagummies.com"}/api/ops/plaid/webhook`;

  const response = await plaidPost<LinkTokenResponse>("/link/token/create", {
    user: { client_user_id: "usagummies-ops" },
    client_name: "USA Gummies Ops",
    products: ["auth"],
    country_codes: ["US"],
    language: "en",
    webhook: webhookUrl,
  });

  return response.link_token;
}

// ---------------------------------------------------------------------------
// Token Exchange (Step 2 — swap public_token for access_token)
// ---------------------------------------------------------------------------

type ExchangeResponse = {
  access_token: string;
  item_id: string;
  request_id: string;
};

export async function exchangePublicToken(publicToken: string): Promise<{
  accessToken: string;
  itemId: string;
}> {
  const response = await plaidPost<ExchangeResponse>("/item/public_token/exchange", {
    public_token: publicToken,
  });

  const connectedAt = new Date().toISOString();

  // Write to KV (fast path for reads)
  await writeState("plaid-access-token", {
    accessToken: response.access_token,
    itemId: response.item_id,
    connectedAt,
  });

  // Write to Supabase (durable backup — survives KV eviction)
  try {
    await sbFetch("/rest/v1/plaid_items", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        item_id: response.item_id,
        access_token: response.access_token,
        institution_name: "Found",
        connected_at: connectedAt,
        status: "active",
      }),
    });
    console.log("[plaid] Token stored in both KV and Supabase");
  } catch (err) {
    console.warn("[plaid] Supabase token backup failed (KV still active):", err);
  }

  return {
    accessToken: response.access_token,
    itemId: response.item_id,
  };
}

// ---------------------------------------------------------------------------
// Supabase helpers (durable backup for access tokens)
// ---------------------------------------------------------------------------

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const env = getSupabaseEnv();
  if (!env) return null;

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(10000),
  });

  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Get stored access token (KV fast-path, Supabase fallback)
// ---------------------------------------------------------------------------

type StoredPlaidToken = {
  accessToken: string;
  itemId: string;
  connectedAt: string;
} | null;

export async function getStoredAccessToken(): Promise<string | null> {
  // Fast path: KV
  const stored = await readState<StoredPlaidToken>("plaid-access-token", null);
  if (stored?.accessToken) return stored.accessToken;

  // Fallback: Supabase (KV may have been evicted)
  try {
    const rows = await sbFetch(
      "/rest/v1/plaid_items?status=eq.active&order=connected_at.desc&limit=1",
      { method: "GET" },
    );
    if (Array.isArray(rows) && rows.length > 0 && rows[0].access_token) {
      // Re-populate KV for next read
      await writeState("plaid-access-token", {
        accessToken: rows[0].access_token,
        itemId: rows[0].item_id,
        connectedAt: rows[0].connected_at,
      });
      return rows[0].access_token;
    }
  } catch (err) {
    console.warn("[plaid] Supabase fallback failed:", err);
  }

  return null;
}

export async function isPlaidConnected(): Promise<boolean> {
  const token = await getStoredAccessToken();
  return !!token;
}

// ---------------------------------------------------------------------------
// Balances (Step 3 — real-time balance fetch)
// ---------------------------------------------------------------------------

type PlaidBalanceResponse = {
  accounts: {
    account_id: string;
    name: string;
    official_name: string | null;
    type: string;
    subtype: string | null;
    balances: {
      available: number | null;
      current: number | null;
      limit: number | null;
      iso_currency_code: string | null;
    };
  }[];
};

export async function getBalances(accessToken?: string): Promise<PlaidAccount[]> {
  const token = accessToken || (await getStoredAccessToken());
  if (!token) return [];

  const response = await plaidPost<PlaidBalanceResponse>("/accounts/balance/get", {
    access_token: token,
  });

  return response.accounts.map((a) => ({
    accountId: a.account_id,
    name: a.name,
    officialName: a.official_name,
    type: a.type,
    subtype: a.subtype,
    balances: {
      available: a.balances.available,
      current: a.balances.current,
      limit: a.balances.limit,
      currency: a.balances.iso_currency_code || "USD",
    },
  }));
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

type PlaidTransactionsResponse = {
  accounts: unknown[];
  transactions: {
    transaction_id: string;
    date: string;
    name: string;
    amount: number;
    category: string[] | null;
    pending: boolean;
    merchant_name: string | null;
  }[];
  total_transactions: number;
};

export async function getTransactions(
  startDate: string,
  endDate: string,
  accessToken?: string,
): Promise<PlaidTransaction[]> {
  const token = accessToken || (await getStoredAccessToken());
  if (!token) return [];

  const response = await plaidPost<PlaidTransactionsResponse>("/transactions/get", {
    access_token: token,
    start_date: startDate,
    end_date: endDate,
    options: { count: 100, offset: 0 },
  });

  return response.transactions.map((t) => ({
    transactionId: t.transaction_id,
    date: t.date,
    name: t.name,
    amount: t.amount,
    category: t.category || [],
    pending: t.pending,
    merchantName: t.merchant_name,
  }));
}
