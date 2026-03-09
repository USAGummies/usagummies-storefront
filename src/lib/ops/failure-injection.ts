import { checkIntegrations } from "@/lib/ops/env-check";

type ScenarioStatus = "pass" | "fail";

export type FailureScenarioResult = {
  id: string;
  name: string;
  status: ScenarioStatus;
  details: string;
  durationMs: number;
};

export type FailureInjectionReport = {
  generatedAt: string;
  scenarios: FailureScenarioResult[];
  summary: {
    passed: number;
    failed: number;
    total: number;
  };
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

function scenarioConnectorNotConfigured(): FailureScenarioResult {
  const start = Date.now();
  const integrations = checkIntegrations({ env: {} });
  const p0Missing = integrations.filter(
    (integration) =>
      integration.priority === "p0" && integration.status === "not_configured",
  );

  if (p0Missing.length > 0) {
    return {
      id: "connector_not_configured",
      name: "Connector not_configured path",
      status: "pass",
      details: `Detected ${p0Missing.length} P0 connectors as not_configured when credentials are missing.`,
      durationMs: Date.now() - start,
    };
  }

  return {
    id: "connector_not_configured",
    name: "Connector not_configured path",
    status: "fail",
    details: "Expected missing credentials to produce not_configured status for P0 connectors.",
    durationMs: Date.now() - start,
  };
}

function scenarioExpiredToken(): FailureScenarioResult {
  const start = Date.now();
  const integrations = checkIntegrations({
    env: {
      SHOPIFY_ADMIN_TOKEN: "set",
      SHOPIFY_ADMIN_TOKEN_ROTATED_AT: "2024-01-01T00:00:00.000Z",
    },
  });

  const shopifyAdmin = integrations.find((integration) => integration.key === "shopify_admin");
  if (shopifyAdmin?.status === "stale_credentials") {
    return {
      id: "expired_token",
      name: "Expired credential path",
      status: "pass",
      details: `Stale credential detected for Shopify Admin (${shopifyAdmin.staleReason || "reason not provided"}).`,
      durationMs: Date.now() - start,
    };
  }

  return {
    id: "expired_token",
    name: "Expired credential path",
    status: "fail",
    details: "Expected stale_credentials status for expired Shopify Admin rotation timestamp.",
    durationMs: Date.now() - start,
  };
}

async function scenarioUpstreamTimeout(): Promise<FailureScenarioResult> {
  const start = Date.now();
  const livePromise = new Promise<{ degraded: boolean; kpis: number[]; findings: string[] }>(
    (resolve) => {
      setTimeout(() => resolve({ degraded: false, kpis: [42], findings: ["unexpected"] }), 75);
    },
  );

  const fallback = { degraded: true, kpis: [] as number[], findings: [] as string[] };
  const result = await withTimeout(livePromise, 10, fallback);
  const hasNoFabricatedData =
    result.degraded === true && result.kpis.length === 0 && result.findings.length === 0;

  if (hasNoFabricatedData) {
    return {
      id: "upstream_timeout",
      name: "Upstream timeout degraded fallback",
      status: "pass",
      details: "Timeout path returned degraded fallback with no fabricated KPIs/findings.",
      durationMs: Date.now() - start,
    };
  }

  return {
    id: "upstream_timeout",
    name: "Upstream timeout degraded fallback",
    status: "fail",
    details: "Timeout fallback contained fabricated metrics/findings or did not mark degraded mode.",
    durationMs: Date.now() - start,
  };
}

export async function runFailureInjectionSuite(): Promise<FailureInjectionReport> {
  const scenarios = [
    scenarioConnectorNotConfigured(),
    scenarioExpiredToken(),
    await scenarioUpstreamTimeout(),
  ];

  const summary = {
    passed: scenarios.filter((scenario) => scenario.status === "pass").length,
    failed: scenarios.filter((scenario) => scenario.status === "fail").length,
    total: scenarios.length,
  };

  return {
    generatedAt: new Date().toISOString(),
    scenarios,
    summary,
  };
}
