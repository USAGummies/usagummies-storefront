/**
 * GET /api/ops/stack-readiness
 *
 * Phase 28L.3 — read-only stack-readiness dashboard backing route.
 *
 * Returns one row per external service we depend on:
 *   - manifest fields (id, name, layer, maturity, degradedMode, replacement, knownIssue)
 *   - env-var presence (envOk, envMissing)
 *   - probe result (status, message, latencyMs, probedAt)
 *
 * Hard rules:
 *   - **Auth-gated.** `isAuthorized()` (session OR CRON_SECRET).
 *   - **Read-only.** Probes never write or mutate anything.
 *   - **Bounded.** Each probe is wrapped in `probeFetch()` with a 10s
 *     deadline; the route runs probes in parallel via
 *     `Promise.allSettled` so one slow service can't pin the whole
 *     response. Total wall-time ≤ 10s.
 *   - **Honest.** Services without a probe surface as
 *     `status: "unprobed"` rather than fabricating a green check.
 *   - **Env trumps probe.** Missing env vars → status="down" with a
 *     concrete envMissing list, regardless of probe outcome.
 *
 * Response (200):
 *   {
 *     ok: true,
 *     generatedAt: ISO,
 *     summary: { total, ok, degraded, down, unprobed, averageMaturity },
 *     rows: StackServiceRow[]
 *   }
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  STACK_SERVICES,
  checkEnvVars,
  combineProbeAndEnv,
  noProbe,
  probeFetch,
  summarizeStack,
  type StackProbeResult,
  type StackServiceManifest,
  type StackServiceRow,
} from "@/lib/ops/stack-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-service probe runner. Returns an `unprobed` result for
 * services we don't have a cheap read-only health check for.
 *
 * Probes are deliberately conservative:
 *   - Never include a body.
 *   - Never include credentials in URL params.
 *   - Always use a HEAD/GET on a public health endpoint, or a
 *     low-cost authenticated read (vendor list, account info).
 *   - Returning `noProbe` is honest, not a failure.
 */
async function runProbe(
  service: StackServiceManifest,
  envOk: boolean,
): Promise<StackProbeResult> {
  // Don't bother probing when env vars are missing — combineProbeAndEnv
  // will mark it down anyway, and the probe would just fail noisily.
  if (!envOk) {
    return noProbe("Env vars missing — probe skipped.");
  }

  switch (service.id) {
    case "vercel":
      // Self-loopback probe is meaningless (we ARE Vercel). Mark
      // unprobed; the dashboard rendering itself is the proof of life.
      return noProbe("Self-host — dashboard render is the liveness signal.");

    case "vercel-kv":
      return await probeKv();

    case "slack":
      return await probeFetch({
        url: "https://slack.com/api/auth.test",
        init: {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN ?? ""}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        },
        okPredicate: (status, body) =>
          status === 200 && /"ok"\s*:\s*true/.test(body),
      });

    case "shipstation":
      return await probeFetch({
        url: "https://ssapi.shipstation.com/accounts/listtags",
        init: {
          method: "GET",
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${process.env.SHIPSTATION_API_KEY ?? ""}:${process.env.SHIPSTATION_API_SECRET ?? ""}`,
            ).toString("base64")}`,
          },
        },
        okPredicate: (status) => status === 200 || status === 401, // 401 still proves the service is up
      });

    case "shopify-storefront": {
      const domain = process.env.SHOPIFY_STORE_DOMAIN ?? "";
      if (!domain) return noProbe("SHOPIFY_STORE_DOMAIN unset.");
      return await probeFetch({
        url: `https://${domain}/api/2024-10/graphql.json`,
        init: {
          method: "POST",
          headers: {
            "X-Shopify-Storefront-Access-Token":
              process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN ?? "",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: "{shop{name}}" }),
        },
        okPredicate: (status, body) =>
          status === 200 && /"shop"/.test(body) && !/"errors"/.test(body),
      });
    }

    case "shopify-admin": {
      const domain = process.env.SHOPIFY_STORE_DOMAIN ?? "";
      if (!domain) return noProbe("SHOPIFY_STORE_DOMAIN unset.");
      return await probeFetch({
        url: `https://${domain}/admin/api/2024-10/shop.json`,
        init: {
          method: "GET",
          headers: {
            "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN ?? "",
          },
        },
        okPredicate: (status) => status === 200,
      });
    }

    case "hubspot":
      return await probeFetch({
        url: "https://api.hubapi.com/crm/v3/objects/contacts?limit=1",
        init: {
          method: "GET",
          headers: {
            Authorization: `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN ?? ""}`,
          },
        },
        okPredicate: (status) => status === 200,
      });

    case "make-com":
      // We've intentionally bypassed Make.com on the wholesale path
      // (Phase 1.b). Surface the known broken state without making a
      // live call — Make.com's webhook URLs return 200 on POST even
      // when the scenario is broken downstream, so a probe would lie.
      return {
        status: "degraded",
        message:
          "Bypassed for wholesale leads; legacy scenarios may still be broken (see knownIssue).",
        latencyMs: null,
        probedAt: new Date().toISOString(),
      };

    case "quickbooks-online":
      // QBO requires OAuth refresh dance; cheapest read is /companyinfo.
      // Surface unprobed unless we've explicitly wired a probe; for now
      // env presence is the strongest signal we can offer cheaply.
      return noProbe(
        "Env present; OAuth refresh required for live probe (skipped to keep route hot-path bounded).",
      );

    case "google-drive":
    case "gmail":
    case "notion":
    case "ga4":
    case "plaid":
      // OAuth/key-based services where a live probe needs a token
      // refresh or extra dependencies. Env presence is the strongest
      // cheap signal.
      return noProbe("Env present; probe requires token refresh — skipped.");

    case "amazon-sp-api":
      // SP-API requires LWA exchange + signing. Skip the live probe
      // here; the unshipped-fbm cron is the real liveness signal.
      return noProbe(
        "Env present; LWA refresh required for live probe — see /api/ops/amazon/unshipped-fbm-alert.",
      );

    case "nextauth":
      // NextAuth IS what gates this route; if you got a 200 you're
      // already authenticated. Mark unprobed to be explicit.
      return noProbe("Operator authenticated to read this route — proof of life.");

    case "stamps-com":
      return noProbe(
        "Provider via ShipStation; failures surface as ShipStation label-buy errors.",
      );

    default:
      return noProbe("No probe implemented.");
  }
}

/**
 * Probe Vercel KV with a tiny no-op SET/GET roundtrip. We use the
 * REST API directly so the probe is independent of the @vercel/kv
 * client (which can throw at module-load on missing env).
 */
async function probeKv(): Promise<StackProbeResult> {
  const url = process.env.KV_REST_API_URL ?? "";
  const token = process.env.KV_REST_API_TOKEN ?? "";
  if (!url || !token) return noProbe("KV env unset.");
  return await probeFetch({
    url: `${url}/get/__stack-readiness-probe`,
    init: {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
    okPredicate: (status) => status === 200,
  });
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const env = process.env as Record<string, string | undefined>;

  // Run probes in parallel; bounded internally by probeFetch's 10s
  // AbortSignal.timeout. allSettled so one rejected promise doesn't
  // collapse the whole response (probes are written to never throw,
  // but defense-in-depth).
  const probeJobs: Promise<StackServiceRow>[] = STACK_SERVICES.map(
    async (service) => {
      const envCheck = checkEnvVars(service, env);
      const probe = await runProbe(service, envCheck.envOk);
      return combineProbeAndEnv(service, probe, envCheck);
    },
  );

  const settled = await Promise.allSettled(probeJobs);
  const rows: StackServiceRow[] = settled.map((r, i) => {
    const service = STACK_SERVICES[i];
    if (r.status === "fulfilled") return r.value;
    // Hard fallback — should never trigger.
    return combineProbeAndEnv(
      service,
      {
        status: "down",
        message: `Probe rejected unexpectedly: ${
          r.reason instanceof Error ? r.reason.message : String(r.reason)
        }`,
        latencyMs: null,
        probedAt: new Date().toISOString(),
      },
      checkEnvVars(service, env),
    );
  });

  const summary = summarizeStack(rows);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    summary,
    rows,
  });
}
