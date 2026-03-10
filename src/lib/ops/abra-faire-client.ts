import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type FaireOrder = {
  id: string;
  order_number?: string;
  total_amount?: number;
  currency?: string;
  buyer_name?: string;
  created_at?: string;
  status?: string;
};

export type FaireProduct = {
  id: string;
  name?: string;
  sku?: string;
  available_quantity?: number;
  status?: string;
};

type FaireCredentials = {
  apiKey: string | null;
  sessionToken: string | null;
};

function readCredentialsFile(): Partial<FaireCredentials> {
  const file = join(homedir(), ".config/usa-gummies-mcp/.faire-credentials");
  if (!existsSync(file)) return {};

  try {
    const raw = readFileSync(file, "utf8").trim();
    if (!raw) return {};

    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const apiKey =
        typeof parsed.FAIRE_API_KEY === "string" ? parsed.FAIRE_API_KEY : null;
      const sessionToken =
        typeof parsed.FAIRE_SESSION_TOKEN === "string"
          ? parsed.FAIRE_SESSION_TOKEN
          : null;
      return { apiKey, sessionToken };
    }

    const vars = Object.fromEntries(
      raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !line.startsWith("#"))
        .map((line) => {
          const idx = line.indexOf("=");
          if (idx < 0) return [line, ""];
          return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
        }),
    ) as Record<string, string>;
    return {
      apiKey: vars.FAIRE_API_KEY || null,
      sessionToken: vars.FAIRE_SESSION_TOKEN || null,
    };
  } catch (error) {
    console.error(
      "[faire-client] Could not parse credential file:",
      error instanceof Error ? error.message : error,
    );
    return {};
  }
}

function getCredentials(): FaireCredentials {
  const fromFile = readCredentialsFile();
  return {
    apiKey: process.env.FAIRE_API_KEY || fromFile.apiKey || null,
    sessionToken:
      process.env.FAIRE_SESSION_TOKEN || fromFile.sessionToken || null,
  };
}

export function isFaireConfigured(): boolean {
  const creds = getCredentials();
  return !!(creds.apiKey || creds.sessionToken);
}

async function faireFetch(path: string): Promise<unknown[] | null> {
  const creds = getCredentials();
  if (!creds.apiKey && !creds.sessionToken) {
    console.log("[faire-client] No Faire credentials configured");
    return null;
  }

  const baseUrl = process.env.FAIRE_API_BASE || "https://www.faire.com/api/v1";
  const headers = new Headers();
  if (creds.apiKey) headers.set("Authorization", `Bearer ${creds.apiKey}`);
  if (creds.sessionToken) headers.set("X-Session-Token", creds.sessionToken);
  headers.set("Accept", "application/json");

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      console.log(`[faire-client] Faire API ${res.status} for ${path}`);
      return [];
    }
    const json = (await res.json()) as Record<string, unknown>;
    const candidates = [
      json.orders,
      json.products,
      json.data,
      Array.isArray(json) ? json : null,
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate as unknown[];
      }
    }
    return [];
  } catch (error) {
    console.error(
      "[faire-client] API request failed:",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

export async function fetchFaireOrders(params?: {
  since?: string;
}): Promise<FaireOrder[]> {
  const since =
    params?.since ||
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = await faireFetch(
    `/orders?updated_at_min=${encodeURIComponent(since)}&limit=100`,
  );
  if (!rows) return [];

  const parsed: FaireOrder[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    if (!id) continue;

    parsed.push({
      id,
      order_number:
        typeof r.order_number === "string" ? r.order_number : undefined,
      total_amount:
        typeof r.total_amount === "number"
          ? r.total_amount
          : Number(r.total_amount || 0),
      currency: typeof r.currency === "string" ? r.currency : undefined,
      buyer_name: typeof r.buyer_name === "string" ? r.buyer_name : undefined,
      created_at: typeof r.created_at === "string" ? r.created_at : undefined,
      status: typeof r.status === "string" ? r.status : undefined,
    });
  }
  return parsed;
}

export async function fetchFaireProducts(): Promise<FaireProduct[]> {
  const rows = await faireFetch("/products?limit=100");
  if (!rows) return [];

  const parsed: FaireProduct[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    if (!id) continue;

    parsed.push({
      id,
      name: typeof r.name === "string" ? r.name : undefined,
      sku: typeof r.sku === "string" ? r.sku : undefined,
      available_quantity:
        typeof r.available_quantity === "number"
          ? r.available_quantity
          : Number(r.available_quantity || 0),
      status: typeof r.status === "string" ? r.status : undefined,
    });
  }
  return parsed;
}
