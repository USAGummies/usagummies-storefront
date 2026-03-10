import { NextResponse } from "next/server";
import { notify } from "@/lib/ops/notify";
import {
  testAmazon,
  testGA4Connection,
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

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  return !!secret && authHeader === `Bearer ${secret}`;
}

type TestSpec = {
  system: string;
  run: () => Promise<IntegrationConnection>;
};

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tests: TestSpec[] = [
    { system: "amazon", run: testAmazon },
    { system: "shopify", run: testShopifyConnection },
    { system: "ga4_analytics", run: testGA4Connection },
    { system: "openai", run: testOpenAIConnection },
    { system: "supabase", run: testSupabaseConnection },
    { system: "slack", run: testSlackConnection },
  ];

  try {
    const settled = await Promise.allSettled(tests.map((test) => test.run()));

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
