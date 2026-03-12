#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const STATUS = {
  PASS: "pass",
  FAIL: "fail",
  WARN: "warn",
  SKIP: "skip",
};

const SLO = {
  minAvailability: 0.95,
  maxP95Ms: 3500,
  maxBudgetPctWarn: 80,
  maxBudgetPctFail: 95,
};

const OUTPUT_DIR = path.resolve(process.cwd(), "output");
const ENV_PATH = path.resolve(process.cwd(), ".env.local");
const DEFAULT_BASE_URL = "https://www.usagummies.com";

const sections = {
  smoke: [],
  workflow: [],
  integrity: [],
  fault: [],
  slo: [],
};

function nowIso() {
  return new Date().toISOString();
}

function fmtMs(ms) {
  return `${Math.round(ms)}ms`;
}

function parseEnvLocal(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const content = fs.readFileSync(filePath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;

    const idx = normalized.indexOf("=");
    if (idx <= 0) continue;

    const key = normalized.slice(0, idx).trim();
    let value = normalized.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function pickEnv(envFile, key, fallback = "") {
  const processValue = process.env[key];
  if (typeof processValue === "string" && processValue.trim()) {
    return processValue.trim();
  }
  const fileValue = envFile[key];
  if (typeof fileValue === "string" && fileValue.trim()) {
    return fileValue.trim();
  }
  return fallback;
}

function add(section, row) {
  sections[section].push(row);
}

function icon(status) {
  if (status === STATUS.PASS) return "✅";
  if (status === STATUS.FAIL) return "❌";
  if (status === STATUS.WARN) return "⚠️";
  return "⏭️";
}

function summarizeBody(value) {
  if (!value) return "(empty)";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  return str.length > 220 ? `${str.slice(0, 220)}...` : str;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function requestJson({
  baseUrl,
  pathName,
  method = "GET",
  authToken,
  body,
  timeoutMs = 30000,
  withAuth = true,
}) {
  const url = `${baseUrl}${pathName}`;
  const headers = { "Content-Type": "application/json" };
  if (withAuth && authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    return {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      json,
      bodyText: text,
      url,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      json: null,
      bodyText: "",
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function statusFromCheck({ pass, warn = false }) {
  if (pass) return warn ? STATUS.WARN : STATUS.PASS;
  return STATUS.FAIL;
}

async function runSmokeMatrix(ctx) {
  const tests = [
    {
      id: "health",
      label: "GET /api/ops/abra/health",
      method: "GET",
      pathName: "/api/ops/abra/health",
      critical: true,
      validate: (res) => res.status === 200,
    },
    {
      id: "integration",
      label: "GET /api/ops/abra/integration-test",
      method: "GET",
      pathName: "/api/ops/abra/integration-test",
      critical: true,
      validate: (res) => res.status === 200,
    },
    {
      id: "chat",
      label: "POST /api/ops/abra/chat",
      method: "POST",
      pathName: "/api/ops/abra/chat",
      critical: true,
      body: { message: "What does USA Gummies sell?" },
      validate: (res) =>
        res.status === 200 &&
        typeof res.json?.reply === "string" &&
        res.json.reply.toLowerCase().includes("gumm"),
    },
    {
      id: "initiative",
      label: "GET /api/ops/abra/initiative?department=finance",
      method: "GET",
      pathName: "/api/ops/abra/initiative?department=finance",
      critical: true,
      validate: (res) => res.status === 200,
    },
    {
      id: "cost",
      label: "GET /api/ops/abra/cost",
      method: "GET",
      pathName: "/api/ops/abra/cost",
      critical: true,
      validate: (res) =>
        res.status === 200 &&
        typeof (res.json?.total ?? res.json?.total_cost) === "number",
    },
    {
      id: "morning",
      label: "GET /api/ops/abra/morning-brief",
      method: "GET",
      pathName: "/api/ops/abra/morning-brief",
      critical: false,
      validate: (res) =>
        res.status === 200 &&
        (typeof res.json?.brief === "string" || res.json?.ok === true),
    },
    {
      id: "signals",
      label: "GET /api/ops/abra/operational-signals",
      method: "GET",
      pathName: "/api/ops/abra/operational-signals",
      critical: false,
      validate: (res) => res.status === 200 && Array.isArray(res.json?.signals),
    },
    {
      id: "pipeline",
      label: "GET /api/ops/abra/pipeline",
      method: "GET",
      pathName: "/api/ops/abra/pipeline",
      critical: true,
      validate: (res) =>
        res.status === 200 && typeof res.json?.total_pipeline_value === "number",
    },
    {
      id: "forecast",
      label: "GET /api/ops/abra/forecast?metric=shopify_revenue_daily&horizon=30",
      method: "GET",
      pathName: "/api/ops/abra/forecast?metric=shopify_revenue_daily&horizon=30",
      critical: false,
      validate: (res) =>
        res.status === 200 &&
        (Array.isArray(res.json?.forecast?.points) || Array.isArray(res.json?.forecasts)),
    },
    {
      id: "attribution",
      label: "GET /api/ops/abra/attribution?period=30d",
      method: "GET",
      pathName: "/api/ops/abra/attribution?period=30d",
      critical: false,
      validate: (res) =>
        res.status === 200 &&
        typeof res.json?.total_revenue_30d === "number",
    },
    {
      id: "inventory",
      label: "GET /api/ops/abra/inventory-forecast",
      method: "GET",
      pathName: "/api/ops/abra/inventory-forecast",
      critical: false,
      validate: (res) =>
        (res.status === 200 && Array.isArray(res.json?.forecasts)) ||
        (res.status === 500 &&
          /(invalidinput|sp-api|amazon)/i.test(
            String(res.json?.error || res.bodyText || ""),
          )),
    },
  ];

  for (const test of tests) {
    if (!ctx.cronSecret) {
      add("smoke", {
        id: test.id,
        label: test.label,
        status: STATUS.SKIP,
        critical: test.critical,
        detail: "CRON_SECRET missing",
        ms: 0,
      });
      continue;
    }

    const res = await requestJson({
      baseUrl: ctx.baseUrl,
      pathName: test.pathName,
      method: test.method,
      authToken: ctx.cronSecret,
      body: test.body,
      withAuth: true,
    });

    const pass = !!test.validate(res);
    let status = statusFromCheck({ pass, warn: pass && res.ms > SLO.maxP95Ms });
    if (!pass && !test.critical && (res.status >= 500 || res.status === 404)) {
      status = STATUS.WARN;
    }
    add("smoke", {
      id: test.id,
      label: test.label,
      status,
      critical: test.critical,
      detail: pass
        ? `${res.status} (${fmtMs(res.ms)})`
        : `${res.status || "ERR"} (${fmtMs(res.ms)}) ${res.error ? `- ${res.error}` : `- ${summarizeBody(res.json || res.bodyText)}`}`,
      ms: res.ms,
      response: res.json,
    });
  }
}

async function runWorkflowChecks(ctx) {
  if (!ctx.cronSecret) {
    add("workflow", {
      label: "Workflow checks",
      status: STATUS.SKIP,
      detail: "CRON_SECRET missing",
    });
    return;
  }

  const intentCases = [
    {
      label: "Chat intent: cost",
      message: "How much are we spending on AI?",
      expect: (json) => json?.intent === "cost" || /spend|budget|total/i.test(String(json?.reply || "")),
    },
    {
      label: "Chat intent: pipeline",
      message: "How's our sales pipeline looking?",
      expect: (json) => json?.intent === "pipeline" || /pipeline|deals|win rate/i.test(String(json?.reply || "")),
    },
    {
      label: "Chat intent: initiative",
      message: "Get finance under control",
      expect: (json) =>
        json?.intent === "initiative" ||
        Boolean(json?.initiative_id) ||
        /finance|playbook|under control/i.test(String(json?.reply || "")),
    },
  ];

  for (const test of intentCases) {
    const res = await requestJson({
      baseUrl: ctx.baseUrl,
      pathName: "/api/ops/abra/chat",
      method: "POST",
      authToken: ctx.cronSecret,
      body: { message: test.message },
      withAuth: true,
    });

    const pass = res.status === 200 && test.expect(res.json);
    add("workflow", {
      label: test.label,
      status: pass ? STATUS.PASS : STATUS.FAIL,
      detail: pass
        ? `ok (${fmtMs(res.ms)})`
        : `${res.status || "ERR"} (${fmtMs(res.ms)}) - ${summarizeBody(res.json || res.bodyText)}`,
      ms: res.ms,
    });
  }

  const marker = `readiness-${Date.now()}`;

  const manualProposal = await requestJson({
    baseUrl: ctx.baseUrl,
    pathName: "/api/ops/abra/actions/propose",
    method: "POST",
    authToken: ctx.cronSecret,
    withAuth: true,
    body: {
      department: "finance",
      action_type: "log_insight",
      title: `Readiness Manual ${marker}`,
      description: `Manual approval flow probe ${marker}`,
      auto_execute: false,
      confidence: 0.92,
      risk_level: "low",
    },
  });

  const usingModernActions = manualProposal.status !== 404;
  const fallbackProposal =
    usingModernActions
      ? null
      : await requestJson({
          baseUrl: ctx.baseUrl,
          pathName: "/api/ops/abra/propose",
          method: "POST",
          authToken: ctx.cronSecret,
          withAuth: true,
          body: {
            action_type: "create_brain_entry",
            description: `Legacy manual approval probe ${marker}`,
            details: {
              title: `Readiness Manual ${marker}`,
              text: `Legacy readiness probe ${marker}`,
            },
            confidence: 0.92,
            risk_level: "low",
          },
        });

  const proposalResult = usingModernActions ? manualProposal : fallbackProposal;
  const approvalId =
    typeof proposalResult?.json?.approval_id === "string" && proposalResult.json.approval_id
      ? proposalResult.json.approval_id
      : "";

  const proposalPass = proposalResult?.status === 200 && Boolean(approvalId);
  add("workflow", {
    label: `Manual proposal create (${usingModernActions ? "modern" : "legacy"})`,
    status: proposalPass ? STATUS.PASS : STATUS.FAIL,
    detail: proposalPass
      ? `approval_id=${approvalId}`
      : `${proposalResult?.status || "ERR"} - ${summarizeBody(proposalResult?.json || proposalResult?.bodyText)}`,
  });

  if (proposalPass) {
    const approveRes = usingModernActions
      ? await requestJson({
          baseUrl: ctx.baseUrl,
          pathName: `/api/ops/abra/approvals/${encodeURIComponent(approvalId)}/approve`,
          method: "POST",
          authToken: ctx.cronSecret,
          withAuth: true,
          body: {},
        })
      : await requestJson({
          baseUrl: ctx.baseUrl,
          pathName: "/api/ops/abra/approvals",
          method: "PATCH",
          authToken: ctx.cronSecret,
          withAuth: true,
          body: {
            id: approvalId,
            decision: "approved",
            comment: "Readiness suite approval",
          },
        });

    const executeRes = usingModernActions
      ? approveRes
      : await requestJson({
          baseUrl: ctx.baseUrl,
          pathName: "/api/ops/abra/actions",
          method: "POST",
          authToken: ctx.cronSecret,
          withAuth: true,
          body: {
            approval_id: approvalId,
            confirm: true,
          },
        });

    const approvePass =
      usingModernActions
        ? approveRes.status === 200 && approveRes.json?.ok === true
        : approveRes.status === 200 && executeRes.status === 200 && executeRes.json?.ok !== false;
    add("workflow", {
      label: "Manual proposal approve/execute",
      status: approvePass ? STATUS.PASS : STATUS.FAIL,
      detail: approvePass
        ? `ok (${fmtMs((approveRes.ms || 0) + (executeRes.ms || 0))})`
        : `approve=${approveRes.status || "ERR"} execute=${executeRes.status || "ERR"}`,
    });
  }

  const autoRes = usingModernActions
    ? await requestJson({
        baseUrl: ctx.baseUrl,
        pathName: "/api/ops/abra/actions/propose",
        method: "POST",
        authToken: ctx.cronSecret,
        withAuth: true,
        body: {
          department: "executive",
          action_type: "log_insight",
          title: `Readiness Auto ${marker}`,
          description: `Auto execute probe ${marker}`,
          auto_execute: true,
          confidence: 0.95,
          risk_level: "low",
        },
      })
    : null;

  const autoExecuted = autoRes?.json?.auto_executed === true;
  const autoPass = autoRes?.status === 200 && Boolean(autoRes.json?.approval_id);
  add("workflow", {
    label: "Auto-exec proposal",
    status: usingModernActions
      ? autoPass
        ? autoExecuted
          ? STATUS.PASS
          : STATUS.WARN
        : STATUS.FAIL
      : STATUS.WARN,
    detail: usingModernActions
      ? autoPass
      ? autoExecuted
        ? "auto_executed=true"
        : "auto_executed=false (likely policy limit)"
      : `${autoRes?.status || "ERR"} - ${summarizeBody(autoRes?.json || autoRes?.bodyText)}`
      : "legacy route deployed; auto-exec probe unavailable",
  });
}

async function sbRequest(ctx, pathName, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", ctx.supabaseServiceKey);
  headers.set("Authorization", `Bearer ${ctx.supabaseServiceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${ctx.supabaseUrl}${pathName}`, {
    ...init,
    headers,
    signal: init.signal || AbortSignal.timeout(15000),
    cache: "no-store",
  });

  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return { res, text, json };
}

async function sbCount(ctx, table, filters = "") {
  const { res, text } = await sbRequest(
    ctx,
    `/rest/v1/${table}?select=id${filters}`,
    {
      method: "HEAD",
      headers: {
        Prefer: "count=exact",
      },
    },
  );

  if (!res.ok) {
    throw new Error(`${table} count failed (${res.status}): ${text}`);
  }

  const contentRange = res.headers.get("content-range") || "*/0";
  const total = Number(contentRange.split("/")[1] || "0");
  return Number.isFinite(total) ? total : 0;
}

function isoDateDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function runIntegrityChecks(ctx) {
  if (!ctx.supabaseUrl || !ctx.supabaseServiceKey) {
    add("integrity", {
      label: "Supabase data integrity",
      status: STATUS.SKIP,
      detail: "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing",
    });
    return;
  }

  const since14 = isoDateDaysAgo(14);
  const basicCounts = [
    {
      label: "email_events rows",
      run: () => sbCount(ctx, "email_events"),
      passIf: (n) => n > 0,
    },
    {
      label: "open_brain_entries rows",
      run: () => sbCount(ctx, "open_brain_entries"),
      passIf: (n) => n > 0,
    },
    {
      label: "abra_deals rows",
      run: () => sbCount(ctx, "abra_deals"),
      passIf: (n) => n > 0,
    },
  ];

  for (const check of basicCounts) {
    try {
      const n = await check.run();
      add("integrity", {
        label: check.label,
        status: check.passIf(n) ? STATUS.PASS : STATUS.FAIL,
        detail: `${n} rows`,
      });
    } catch (error) {
      add("integrity", {
        label: check.label,
        status: /404/.test(String(error instanceof Error ? error.message : error))
          ? STATUS.WARN
          : STATUS.FAIL,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const metricFamilies = [
    {
      label: "Shopify revenue coverage (14d)",
      metrics: ["daily_revenue_shopify", "shopify_revenue_daily"],
      min: 7,
    },
    {
      label: "Amazon revenue coverage (14d)",
      metrics: ["daily_revenue_amazon", "amazon_revenue_daily"],
      min: 7,
    },
    {
      label: "Sessions coverage (14d)",
      metrics: ["daily_sessions", "ga4_sessions_daily"],
      min: 7,
    },
    {
      label: "Conversion coverage (14d)",
      metrics: ["conversion_rate", "ga4_conversion_rate"],
      min: 7,
    },
  ];

  for (const family of metricFamilies) {
    try {
      let maxCount = 0;
      for (const metric of family.metrics) {
        const count = await sbCount(
          ctx,
          "kpi_timeseries",
          `&window_type=eq.daily&metric_name=eq.${encodeURIComponent(metric)}&captured_for_date=gte.${since14}`,
        );
        maxCount = Math.max(maxCount, count);
      }
      add("integrity", {
        label: family.label,
        status: maxCount >= family.min ? STATUS.PASS : STATUS.WARN,
        detail: `${maxCount} rows (min ${family.min})`,
      });
    } catch (error) {
      add("integrity", {
        label: family.label,
        status: STATUS.FAIL,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    const nullProviderIds = await sbCount(ctx, "email_events", "&provider_message_id=is.null");
    add("integrity", {
      label: "email_events null provider_message_id",
      status: nullProviderIds === 0 ? STATUS.PASS : STATUS.FAIL,
      detail: `${nullProviderIds}`,
    });
  } catch (error) {
    add("integrity", {
      label: "email_events null provider_message_id",
      status: STATUS.FAIL,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const { res, json, text } = await sbRequest(
      ctx,
      "/rest/v1/abra_auto_teach_feeds?select=feed_key,last_run_at,is_active&feed_key=in.(shopify_orders,shopify_products,ga4_traffic)",
    );

    if (!res.ok) {
      throw new Error(`${res.status}: ${text}`);
    }

    const rows = Array.isArray(json) ? json : [];
    let stale = 0;
    const cutoff = Date.now() - 72 * 60 * 60 * 1000;

    for (const row of rows) {
      if (!row?.is_active) continue;
      const lastRunMs = row.last_run_at ? new Date(row.last_run_at).getTime() : 0;
      if (!lastRunMs || lastRunMs < cutoff) stale += 1;
    }

    add("integrity", {
      label: "Feed freshness (shopify/ga4 <=72h)",
      status: stale === 0 ? STATUS.PASS : STATUS.WARN,
      detail: stale === 0 ? "fresh" : `${stale} stale feed(s)`,
    });
  } catch (error) {
    add("integrity", {
      label: "Feed freshness (shopify/ga4 <=72h)",
      status: STATUS.FAIL,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runFaultInjectionChecks(ctx) {
  const actionsProbe = ctx.cronSecret
    ? await requestJson({
        baseUrl: ctx.baseUrl,
        pathName: "/api/ops/abra/actions/propose",
        method: "POST",
        authToken: ctx.cronSecret,
        withAuth: true,
        body: {},
      })
    : null;
  const usingModernActions = !!actionsProbe && actionsProbe.status !== 404;

  const feedProbe = ctx.cronSecret
    ? await requestJson({
        baseUrl: ctx.baseUrl,
        pathName: "/api/ops/abra/feeds/amazon",
        method: "POST",
        authToken: ctx.cronSecret,
        withAuth: true,
        body: {},
      })
    : null;
  const usingModernFeeds = !!feedProbe && feedProbe.status !== 404;

  const tests = [
    {
      label: "Unauthorized chat returns 401",
      run: () =>
        requestJson({
          baseUrl: ctx.baseUrl,
          pathName: "/api/ops/abra/chat",
          method: "POST",
          body: { message: "hello" },
          withAuth: false,
        }),
      expect: (res) => res.status === 401,
    },
    {
      label: "Unauthorized cost returns 401",
      run: () =>
        requestJson({
          baseUrl: ctx.baseUrl,
          pathName: "/api/ops/abra/cost",
          method: "GET",
          withAuth: false,
        }),
      expect: (res) => res.status === 401,
    },
    {
      label: "Chat oversize payload returns 400",
      run: () =>
        requestJson({
          baseUrl: ctx.baseUrl,
          pathName: "/api/ops/abra/chat",
          method: "POST",
          authToken: ctx.cronSecret,
          withAuth: true,
          body: { message: "x".repeat(5001) },
        }),
      expect: (res) => res.status === 400,
    },
    {
      label: "Initiative invalid department returns 400",
      run: () =>
        requestJson({
          baseUrl: ctx.baseUrl,
          pathName: "/api/ops/abra/initiative?department=__invalid__",
          method: "GET",
          authToken: ctx.cronSecret,
          withAuth: true,
        }),
      expect: (res) => res.status === 400,
    },
    {
      label: "Actions/propose validation returns 400",
      run: () =>
        requestJson({
          baseUrl: ctx.baseUrl,
          pathName: usingModernActions
            ? "/api/ops/abra/actions/propose"
            : "/api/ops/abra/propose",
          method: "POST",
          authToken: ctx.cronSecret,
          withAuth: true,
          body: usingModernActions
            ? { action_type: "log_insight" }
            : { action_type: "create_brain_entry" },
        }),
      expect: (res) => res.status === 400,
    },
    {
      label: "Approve non-existent ID handled",
      run: () =>
        requestJson({
          baseUrl: ctx.baseUrl,
          pathName: usingModernActions
            ? "/api/ops/abra/approvals/not-a-real-id/approve"
            : "/api/ops/abra/actions",
          method: "POST",
          authToken: ctx.cronSecret,
          withAuth: true,
          body: usingModernActions
            ? {}
            : { approval_id: "not-a-real-id", confirm: true },
        }),
      expect: (res) => res.status === 400,
    },
    {
      label: "Amazon feed fails gracefully (no 500)",
      run: () =>
        requestJson({
          baseUrl: ctx.baseUrl,
          pathName: usingModernFeeds
            ? "/api/ops/abra/feeds/amazon"
            : "/api/ops/abra/auto-teach?feed=amazon_orders",
          method: "POST",
          authToken: ctx.cronSecret,
          withAuth: true,
          body: {},
        }),
      expect: (res) => [200, 400, 401, 403, 424].includes(res.status),
    },
    {
      label: "Faire feed fails gracefully (no 500)",
      run: () =>
        requestJson({
          baseUrl: ctx.baseUrl,
          pathName: usingModernFeeds
            ? "/api/ops/abra/feeds/faire"
            : "/api/ops/abra/auto-teach?feed=faire_orders",
          method: "POST",
          authToken: ctx.cronSecret,
          withAuth: true,
          body: {},
        }),
      expect: (res) => [200, 400, 401, 403, 424].includes(res.status),
    },
  ];

  for (const test of tests) {
    if (!ctx.cronSecret && test.label !== "Unauthorized chat returns 401" && test.label !== "Unauthorized cost returns 401") {
      add("fault", {
        label: test.label,
        status: STATUS.SKIP,
        detail: "CRON_SECRET missing",
      });
      continue;
    }

    const res = await test.run();
    const pass = test.expect(res);
    add("fault", {
      label: test.label,
      status: pass ? STATUS.PASS : STATUS.FAIL,
      detail: pass
        ? `${res.status} (${fmtMs(res.ms)})`
        : `${res.status || "ERR"} (${fmtMs(res.ms)}) - ${summarizeBody(res.json || res.bodyText || res.error)}`,
      ms: res.ms,
    });
  }
}

async function runSloChecks(ctx) {
  const smoke = sections.smoke.filter((row) => row.status !== STATUS.SKIP);
  const criticalSmoke = smoke.filter((row) => row.critical);
  const smokePass = smoke.filter((row) => row.status === STATUS.PASS || row.status === STATUS.WARN).length;
  const criticalPass = criticalSmoke.filter((row) => row.status === STATUS.PASS || row.status === STATUS.WARN).length;
  const availability = criticalSmoke.length > 0 ? criticalPass / criticalSmoke.length : 0;

  const latencies = smoke
    .map((row) => Number(row.ms || 0))
    .filter((ms) => Number.isFinite(ms) && ms > 0)
    .sort((a, b) => a - b);
  const p95 = percentile(latencies, 95);

  const criticalFailures = sections.smoke.filter((row) => row.critical && row.status === STATUS.FAIL).length;

  add("slo", {
    label: "Endpoint availability",
    status: availability >= SLO.minAvailability ? STATUS.PASS : STATUS.FAIL,
    detail: `${(availability * 100).toFixed(1)}% (target ${(SLO.minAvailability * 100).toFixed(1)}%)`,
  });

  add("slo", {
    label: "Smoke latency p95",
    status: p95 <= SLO.maxP95Ms ? STATUS.PASS : STATUS.WARN,
    detail: `${fmtMs(p95)} (target <= ${fmtMs(SLO.maxP95Ms)})`,
  });

  add("slo", {
    label: "Critical endpoint failures",
    status: criticalFailures === 0 ? STATUS.PASS : STATUS.FAIL,
    detail: `${criticalFailures}`,
  });

  const costRow = sections.smoke.find((row) => row.id === "cost");
  const pctUsed = Number(costRow?.response?.pctUsed ?? costRow?.response?.pct_used ?? NaN);
  if (Number.isFinite(pctUsed)) {
    add("slo", {
      label: "AI budget utilization",
      status:
        pctUsed >= SLO.maxBudgetPctFail
          ? STATUS.FAIL
          : pctUsed >= SLO.maxBudgetPctWarn
            ? STATUS.WARN
            : STATUS.PASS,
      detail: `${pctUsed.toFixed(1)}% used`,
    });
  }

  const totalFails = Object.values(sections)
    .flat()
    .filter((row) => row.status === STATUS.FAIL).length;

  if (totalFails > 0 && ctx.baseUrl && ctx.cronSecret) {
    const alertText = [
      "🚨 Abra Readiness Suite detected failures",
      `Base URL: ${ctx.baseUrl}`,
      `Failures: ${totalFails}`,
      `Availability: ${(availability * 100).toFixed(1)}%`,
      `P95 latency: ${fmtMs(p95)}`,
    ].join("\n");

    const alertRes = await requestJson({
      baseUrl: ctx.baseUrl,
      pathName: "/api/ops/notify",
      method: "POST",
      authToken: ctx.cronSecret,
      withAuth: true,
      body: {
        channel: "alerts",
        text: alertText,
      },
    });

    add("slo", {
      label: "Failure alert dispatch",
      status: alertRes.status === 200 ? STATUS.PASS : STATUS.WARN,
      detail:
        alertRes.status === 200
          ? "alert sent"
          : `alert failed (${alertRes.status || "ERR"})`,
    });
  }
}

function renderSection(title, rows) {
  const lines = [`${title}`];
  for (const row of rows) {
    const detail = row.detail || "";
    lines.push(`  ${icon(row.status)} ${row.label}: ${detail}`);
  }
  return lines.join("\n");
}

function buildSummary() {
  const all = Object.values(sections).flat();
  return {
    pass: all.filter((row) => row.status === STATUS.PASS).length,
    warn: all.filter((row) => row.status === STATUS.WARN).length,
    fail: all.filter((row) => row.status === STATUS.FAIL).length,
    skip: all.filter((row) => row.status === STATUS.SKIP).length,
    total: all.length,
  };
}

function writeArtifacts(ctx, summary) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = nowIso().replace(/[.:]/g, "-");
  const baseName = `abra-readiness-suite-${stamp}`;

  const payload = {
    generatedAt: nowIso(),
    baseUrl: ctx.baseUrl,
    summary,
    sections,
    thresholds: SLO,
  };

  const jsonPath = path.join(OUTPUT_DIR, `${baseName}.json`);
  const mdPath = path.join(OUTPUT_DIR, `${baseName}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");

  const md = [
    "# Abra Production Readiness Suite",
    "",
    `- Generated: ${payload.generatedAt}`,
    `- Base URL: ${ctx.baseUrl}`,
    `- Summary: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail, ${summary.skip} skip, ${summary.total} total`,
    "",
    renderSection("## Smoke Matrix", sections.smoke),
    "",
    renderSection("## Workflow Checks", sections.workflow),
    "",
    renderSection("## Data Integrity", sections.integrity),
    "",
    renderSection("## Fault Injection", sections.fault),
    "",
    renderSection("## SLO & Alerting", sections.slo),
    "",
  ].join("\n");

  fs.writeFileSync(mdPath, md, "utf8");
  return { jsonPath, mdPath };
}

async function main() {
  const envFile = parseEnvLocal(ENV_PATH);

  const baseUrl = (process.argv[2] || pickEnv(envFile, "ABRA_BASE_URL", DEFAULT_BASE_URL)).replace(/\/+$/, "");
  const cronSecret = pickEnv(envFile, "CRON_SECRET", "");
  const supabaseUrl = pickEnv(envFile, "SUPABASE_URL", pickEnv(envFile, "NEXT_PUBLIC_SUPABASE_URL", ""));
  const supabaseServiceKey = pickEnv(envFile, "SUPABASE_SERVICE_ROLE_KEY", "");

  const ctx = {
    baseUrl,
    cronSecret,
    supabaseUrl,
    supabaseServiceKey,
  };

  console.log(`[abra-readiness] base url: ${baseUrl}`);
  console.log("[abra-readiness] running smoke matrix...");
  await runSmokeMatrix(ctx);

  console.log("[abra-readiness] running workflow checks...");
  await runWorkflowChecks(ctx);

  console.log("[abra-readiness] running data integrity checks...");
  await runIntegrityChecks(ctx);

  console.log("[abra-readiness] running fault injection checks...");
  await runFaultInjectionChecks(ctx);

  console.log("[abra-readiness] evaluating SLOs + alerts...");
  await runSloChecks(ctx);

  const summary = buildSummary();
  const artifacts = writeArtifacts(ctx, summary);

  console.log("");
  console.log(renderSection("SMOKE", sections.smoke));
  console.log("");
  console.log(renderSection("WORKFLOW", sections.workflow));
  console.log("");
  console.log(renderSection("INTEGRITY", sections.integrity));
  console.log("");
  console.log(renderSection("FAULT", sections.fault));
  console.log("");
  console.log(renderSection("SLO", sections.slo));
  console.log("");
  console.log(
    `[abra-readiness] summary: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail, ${summary.skip} skip (${summary.total} total)`,
  );
  console.log(`[abra-readiness] artifacts: ${path.relative(process.cwd(), artifacts.jsonPath)}`);
  console.log(`[abra-readiness] artifacts: ${path.relative(process.cwd(), artifacts.mdPath)}`);

  process.exit(summary.fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`[abra-readiness] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
