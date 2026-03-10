import { generateEmbedding } from "@/lib/ops/abra-embeddings";
import { fetchGA4Report } from "@/lib/ops/abra-ga4-client";
import { testAmazonConnection } from "@/lib/amazon/sp-api";

export type IntegrationConnection = {
  configured: boolean;
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
};

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase not configured");

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!res.ok) {
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${typeof json === "string" ? json : JSON.stringify(json)}`,
    );
  }

  return json;
}

export async function updateIntegrationHealth(
  systemName: string,
  status: "connected" | "expired" | "error" | "not_configured",
  errorSummary?: string | null,
): Promise<void> {
  const payload = {
    system_name: systemName,
    connection_status: status,
    ...(status === "connected"
      ? {
          last_success_at: new Date().toISOString(),
          error_summary: null,
          retry_count: 0,
        }
      : {
          last_error_at: new Date().toISOString(),
          error_summary: (errorSummary || "Connection test failed").slice(0, 500),
        }),
  };

  await sbFetch("/rest/v1/integration_health?on_conflict=system_name", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify([payload]),
  });
}

export async function testShopifyConnection(): Promise<IntegrationConnection> {
  const token =
    process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const store = process.env.SHOPIFY_STORE || process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_API_VERSION || "2024-10";

  if (!token || !store) {
    return {
      configured: false,
      ok: false,
      message: "SHOPIFY_STORE/SHOPIFY_ADMIN_TOKEN not configured",
    };
  }

  const host = store.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const res = await fetch(`https://${host}/admin/api/${version}/shop.json`, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text();
    return {
      configured: true,
      ok: false,
      message: `Shopify API ${res.status}: ${text.slice(0, 220)}`,
    };
  }

  return { configured: true, ok: true, message: "ok" };
}

export async function testGA4Connection(): Promise<IntegrationConnection> {
  const hasCreds =
    process.env.GA4_SERVICE_ACCOUNT_JSON || process.env.GA4_SERVICE_ACCOUNT_PATH;
  const hasProperty = !!process.env.GA4_PROPERTY_ID;
  if (!hasCreds || !hasProperty) {
    return {
      configured: false,
      ok: false,
      message: "GA4 credentials/property not configured",
    };
  }

  try {
    await fetchGA4Report({ startDate: "yesterday", endDate: "yesterday" });
    return { configured: true, ok: true, message: "ok" };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function testOpenAIConnection(): Promise<IntegrationConnection> {
  if (!process.env.OPENAI_API_KEY) {
    return {
      configured: false,
      ok: false,
      message: "OPENAI_API_KEY not configured",
    };
  }

  try {
    await generateEmbedding("test");
    return { configured: true, ok: true, message: "ok" };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function testSupabaseConnection(): Promise<IntegrationConnection> {
  if (!getSupabaseEnv()) {
    return {
      configured: false,
      ok: false,
      message: "Supabase env not configured",
    };
  }

  try {
    await sbFetch("/rest/v1/open_brain_entries?select=id&limit=1");
    return { configured: true, ok: true, message: "ok" };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function testSlackConnection(): Promise<IntegrationConnection> {
  const webhook = process.env.SLACK_SUPPORT_WEBHOOK_URL;
  if (!webhook) {
    return {
      configured: false,
      ok: false,
      message: "SLACK_SUPPORT_WEBHOOK_URL not configured",
    };
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `[TEST] Abra integration check ${new Date().toISOString()}`,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        configured: true,
        ok: false,
        message: `Slack webhook ${res.status}: ${text.slice(0, 220)}`,
      };
    }
    return { configured: true, ok: true, message: "ok" };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function testAmazon(): Promise<IntegrationConnection> {
  const result = await testAmazonConnection();
  if (!result.configured) {
    return {
      configured: false,
      ok: false,
      message: result.errors.join("; ") || "Amazon not configured",
      details: result,
    };
  }

  const ok = result.tokenOk && result.ordersOk && result.inventoryOk;
  return {
    configured: true,
    ok,
    message: ok ? "ok" : result.errors.join("; "),
    details: result,
  };
}
