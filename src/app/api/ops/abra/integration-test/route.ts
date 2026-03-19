import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import { notify } from "@/lib/ops/notify";
import {
  testAmazon,
  testGA4Connection,
  testGmailConnection,
  testOpenAIConnection,
  testShopifyConnection,
  testSlackConnection,
  testSupabaseConnection,
  updateIntegrationHealth,
  type IntegrationConnection,
} from "@/lib/ops/abra-integration-test";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type TestSpec = {
  system: string;
  run: () => Promise<IntegrationConnection>;
};

type IntegrationHealthRow = {
  system_name: string;
  connection_status: "connected" | "expired" | "error" | "not_configured";
  error_summary: string | null;
  updated_at: string | null;
  last_success_at?: string | null;
  last_error_at?: string | null;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
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
    signal: init.signal || AbortSignal.timeout(8000),
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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }
  return json;
}

async function runWithTimeout(
  run: () => Promise<IntegrationConnection>,
  timeoutMs: number,
): Promise<IntegrationConnection> {
  return Promise.race<IntegrationConnection>([
    run(),
    new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          configured: true,
          ok: false,
          message: `timeout after ${Math.round(timeoutMs / 1000)}s`,
        });
      }, timeoutMs);
    }),
  ]);
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const mode = (url.searchParams.get("mode") || "full").toLowerCase();
  const quickMode = mode === "quick" || mode === "health";

  if (quickMode) {
    try {
      const rows = (await sbFetch(
        "/rest/v1/integration_health?select=system_name,connection_status,error_summary,updated_at,last_success_at,last_error_at&order=system_name.asc",
      )) as IntegrationHealthRow[];

      const results = Array.isArray(rows)
        ? rows.map((row) => ({
            system: row.system_name,
            configured: row.connection_status !== "not_configured",
            ok: row.connection_status === "connected",
            status: row.connection_status,
            message: row.error_summary || "ok",
            checked_at:
              row.last_success_at || row.updated_at || row.last_error_at || null,
          }))
        : [];

      const summary = {
        total: results.length,
        connected: results.filter((item) => item.status === "connected").length,
        error: results.filter((item) => item.status === "error").length,
        not_configured: results.filter((item) => item.status === "not_configured")
          .length,
      };

      return NextResponse.json({
        ok: summary.error === 0,
        mode: "quick",
        summary,
        results,
        checked_at: new Date().toISOString(),
      });
    } catch {
      const configuredChecks = [
        {
          system: "amazon",
          configured: !!(process.env.LWA_CLIENT_ID && process.env.LWA_CLIENT_SECRET && process.env.LWA_REFRESH_TOKEN),
          status: "not_configured" as const,
        },
        {
          system: "shopify",
          configured: !!((process.env.SHOPIFY_STORE || process.env.SHOPIFY_STORE_DOMAIN) && (process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN)),
          status: "not_configured" as const,
        },
        {
          system: "ga4_analytics",
          configured: !!((process.env.GA4_SERVICE_ACCOUNT_JSON || process.env.GA4_SERVICE_ACCOUNT_PATH) && process.env.GA4_PROPERTY_ID),
          status: "not_configured" as const,
        },
        {
          system: "gmail",
          configured: !!((process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GCP_GMAIL_OAUTH_CLIENT_ID) && (process.env.GMAIL_OAUTH_CLIENT_SECRET || process.env.GCP_GMAIL_OAUTH_CLIENT_SECRET) && (process.env.GMAIL_OAUTH_REFRESH_TOKEN || process.env.GCP_GMAIL_OAUTH_REFRESH_TOKEN)),
          status: "not_configured" as const,
        },
        {
          system: "openai",
          configured: !!process.env.OPENAI_API_KEY,
          status: "not_configured" as const,
        },
        {
          system: "supabase",
          configured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
          status: "not_configured" as const,
        },
        {
          system: "slack",
          configured: !!process.env.SLACK_SUPPORT_WEBHOOK_URL,
          status: "not_configured" as const,
        },
      ].map((item) => ({
        system: item.system,
        configured: item.configured,
        ok: item.configured,
        status: item.configured ? "connected" : item.status,
        message: item.configured ? "configured" : "not configured",
      }));

      const summary = {
        total: configuredChecks.length,
        connected: configuredChecks.filter((item) => item.ok).length,
        error: 0,
        not_configured: configuredChecks.filter((item) => !item.ok).length,
      };

      return NextResponse.json({
        ok: true,
        mode: "quick",
        summary,
        results: configuredChecks,
        checked_at: new Date().toISOString(),
      });
    }
  }

  const tests: TestSpec[] = [
    { system: "amazon", run: testAmazon },
    { system: "shopify", run: testShopifyConnection },
    { system: "ga4_analytics", run: testGA4Connection },
    { system: "gmail", run: testGmailConnection },
    { system: "openai", run: testOpenAIConnection },
    { system: "supabase", run: testSupabaseConnection },
    { system: "slack", run: testSlackConnection },
  ];

  try {
    const settled = await Promise.allSettled(
      tests.map((test) => runWithTimeout(test.run, 12000)),
    );

    const results = await Promise.all(
      settled.map(async (result, idx) => {
        const system = tests[idx]?.system || "unknown";
        let status: "connected" | "expired" | "error" | "not_configured" =
          "error";
        let message = "Unknown failure";
        let configured = true;
        let ok = false;
        let details: Record<string, unknown> | undefined;

        if (result.status === "fulfilled") {
          configured = result.value.configured;
          ok = result.value.ok;
          message = result.value.message;
          details = result.value.details;
          if (!configured) status = "not_configured";
          else status = ok ? "connected" : "error";
        } else {
          message =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
          status = "error";
        }

        try {
          await updateIntegrationHealth(
            system,
            status,
            status === "connected" ? null : message,
          );
        } catch {
          // best-effort
        }

        return {
          system,
          configured,
          ok,
          status,
          message,
          ...(details ? { details } : {}),
        };
      }),
    );

    const summary = {
      total: results.length,
      connected: results.filter((item) => item.status === "connected").length,
      error: results.filter((item) => item.status === "error").length,
      not_configured: results.filter((item) => item.status === "not_configured")
        .length,
    };

    return NextResponse.json({
      ok: summary.error === 0,
      summary,
      results,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Integration test failed";
    console.error("[integration-test] failed:", error);
    void notify({
      channel: "alerts",
      text: `🚨 Abra integration test failed: ${message}`,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
