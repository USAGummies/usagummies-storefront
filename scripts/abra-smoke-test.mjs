#!/usr/bin/env node

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.NEXTAUTH_URL || "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET || "";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const STATUS = {
  PASS: "pass",
  FAIL: "fail",
  SKIP: "skip",
};

const sections = {
  endpoint: [],
  feed: [],
  supabase: [],
  external: [],
};

function nowIso() {
  return new Date().toISOString();
}

function fmtMs(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function mark(section, entry) {
  sections[section].push(entry);
}

function icon(status, warn = false) {
  if (status === STATUS.PASS) return warn ? "⚠️" : "✅";
  if (status === STATUS.SKIP) return "⏭️";
  return "❌";
}

function statusFromHttp(status) {
  if (status >= 500) return STATUS.FAIL;
  if (status === 401 || status === 403) return STATUS.PASS;
  if (status >= 200 && status < 400) return STATUS.PASS;
  return STATUS.FAIL;
}

function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function httpTest(config) {
  const start = Date.now();
  const url = `${BASE_URL}${config.path}`;
  const headers = {
    "Content-Type": "application/json",
    ...(config.auth && CRON_SECRET
      ? { Authorization: `Bearer ${CRON_SECRET}` }
      : {}),
    ...(config.headers || {}),
  };

  try {
    if (config.auth && !CRON_SECRET) {
      return {
        status: STATUS.SKIP,
        detail: "CRON_SECRET missing",
        ms: Date.now() - start,
      };
    }

    const res = await fetch(url, {
      method: config.method || "GET",
      headers,
      body: config.body ? JSON.stringify(config.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });

    const text = await res.text();
    const data = parseJsonSafe(text);
    const ms = Date.now() - start;
    const state = statusFromHttp(res.status);
    const warn = ms > 3000;

    let detail = `${res.status} (${fmtMs(ms)})`;
    if (state === STATUS.FAIL) {
      const errorText =
        typeof data === "string"
          ? data
          : data && typeof data === "object"
            ? JSON.stringify(data)
            : "request failed";
      detail = `${res.status} (${fmtMs(ms)}) — ${String(errorText).slice(0, 180)}`;
    }

    return { status: state, detail, ms, warn, data };
  } catch (error) {
    const ms = Date.now() - start;
    return {
      status: STATUS.FAIL,
      detail: `error (${fmtMs(ms)}) — ${error instanceof Error ? error.message : String(error)}`,
      ms,
    };
  }
}

async function runHealthChecks() {
  const checks = [
    { label: "/api/ops/abra/auto-teach", method: "GET", path: "/api/ops/abra/auto-teach" },
    {
      label: "/api/ops/abra/chat",
      method: "POST",
      path: "/api/ops/abra/chat",
      body: { message: "What is USA Gummies?" },
      auth: true,
    },
    { label: "/api/ops/abra/cost", method: "GET", path: "/api/ops/abra/cost", auth: true },
    { label: "/api/ops/abra/accuracy", method: "GET", path: "/api/ops/abra/accuracy", auth: true },
    {
      label: "/api/ops/abra/morning-brief",
      method: "POST",
      path: "/api/ops/abra/morning-brief",
      auth: true,
    },
    { label: "/api/ops/abra/finance", method: "GET", path: "/api/ops/abra/finance", auth: true },
    {
      label: "/api/ops/abra/competitors",
      method: "GET",
      path: "/api/ops/abra/competitors",
      auth: true,
    },
    {
      label: "/api/ops/abra/operational-signals",
      method: "GET",
      path: "/api/ops/abra/operational-signals",
      auth: true,
    },
    {
      label: "/api/ops/scheduler/master",
      method: "GET",
      path: "/api/ops/scheduler/master",
      auth: true,
    },
  ];

  for (const check of checks) {
    const result = await httpTest(check);
    mark("endpoint", {
      label: check.label,
      status: result.status,
      detail: result.detail,
      warn: result.warn,
    });
  }
}

function parseFeedResult(data) {
  if (!data || typeof data !== "object") return null;
  const results = Array.isArray(data.results) ? data.results : [];
  return results[0] || null;
}

async function runFeedChecks() {
  const feeds = [
    "shopify_orders",
    "shopify_products",
    "shopify_inventory",
    "ga4_traffic",
    "amazon_orders",
    "amazon_inventory",
    "faire_orders",
    "inventory_alerts",
  ];

  if (!CRON_SECRET) {
    for (const key of feeds) {
      mark("feed", {
        label: key,
        status: STATUS.SKIP,
        detail: "skipped (CRON_SECRET missing)",
      });
    }
    return;
  }

  for (const feed of feeds) {
    const result = await httpTest({
      label: feed,
      method: "POST",
      path: `/api/ops/abra/auto-teach?feed=${encodeURIComponent(feed)}`,
      auth: true,
    });

    if (result.status !== STATUS.PASS) {
      mark("feed", {
        label: feed,
        status: STATUS.FAIL,
        detail: result.detail,
      });
      continue;
    }

    const row = parseFeedResult(result.data);
    const entries = Number(row?.entriesCreated || 0);
    const err = typeof row?.error === "string" ? row.error : "";
    if (err && /not configured|skipping/i.test(err)) {
      mark("feed", {
        label: feed,
        status: STATUS.SKIP,
        detail: `skipped (${err.slice(0, 140)})`,
      });
      continue;
    }

    if (row && row.success === false) {
      mark("feed", {
        label: feed,
        status: STATUS.FAIL,
        detail: `error: ${(err || "feed failed").slice(0, 160)}`,
      });
      continue;
    }

    mark("feed", {
      label: feed,
      status: STATUS.PASS,
      detail: `${entries} entries created`,
    });
  }
}

async function sbRequest(path, init = {}) {
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...init.headers,
  };

  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });

  return res;
}

async function sbCount(table, filters = "") {
  const res = await sbRequest(`/rest/v1/${table}?select=id${filters}`, {
    method: "HEAD",
    headers: {
      Prefer: "count=exact",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${table}: ${res.status} ${text}`);
  }

  const range = res.headers.get("content-range") || "";
  const total = Number(range.split("/")[1] || "0");
  return Number.isFinite(total) ? total : 0;
}

async function runSupabaseChecks() {
  const specs = [
    {
      label: "open_brain_entries",
      run: () => sbCount("open_brain_entries"),
      format: (value) => `${value} rows`,
    },
    {
      label: "abra_auto_teach_feeds",
      run: async () => {
        const res = await sbRequest(
          "/rest/v1/abra_auto_teach_feeds?select=feed_key,last_run_at&order=feed_key.asc",
        );
        const text = await res.text();
        const data = parseJsonSafe(text);
        if (!res.ok) throw new Error(`${res.status} ${text}`);
        return Array.isArray(data) ? data.length : 0;
      },
      format: (value) => `${value} feeds`,
    },
    {
      label: "kpi_timeseries (7d)",
      run: () => {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        return sbCount("kpi_timeseries", `&captured_at=gte.${encodeURIComponent(since)}`);
      },
      format: (value) => `${value} rows (7d)`,
    },
    {
      label: "abra_operational_signals (active)",
      run: () => sbCount("abra_operational_signals", "&resolved=eq.false"),
      format: (value) => `${value} active`,
    },
    {
      label: "abra_chat_history",
      run: () => sbCount("abra_chat_history"),
      format: (value) => `${value} rows`,
    },
    {
      label: "abra_competitor_intel",
      run: () => sbCount("abra_competitor_intel"),
      format: (value) => `${value} rows`,
    },
    {
      label: "integration_health",
      run: async () => {
        const res = await sbRequest(
          "/rest/v1/integration_health?select=system_name,connection_status,last_checked_at&order=system_name.asc",
        );
        const text = await res.text();
        const data = parseJsonSafe(text);
        if (!res.ok) throw new Error(`${res.status} ${text}`);
        return Array.isArray(data) ? data.length : 0;
      },
      format: (value) => `${value} systems`,
    },
  ];

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    for (const spec of specs) {
      mark("supabase", {
        label: spec.label,
        status: STATUS.SKIP,
        detail: "skipped (SUPABASE env missing)",
      });
    }
    return;
  }

  for (const spec of specs) {
    const start = Date.now();
    try {
      const value = await spec.run();
      mark("supabase", {
        label: spec.label,
        status: STATUS.PASS,
        detail: `${spec.format(value)} (${fmtMs(Date.now() - start)})`,
      });
    } catch (error) {
      mark("supabase", {
        label: spec.label,
        status: STATUS.FAIL,
        detail: `${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}

async function testOpenAIEmbedding() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { status: STATUS.SKIP, detail: "OPENAI_API_KEY not set" };

  const start = Date.now();
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: "test",
      dimensions: 1536,
    }),
    signal: AbortSignal.timeout(15000),
  });

  const body = parseJsonSafe(await res.text());
  if (!res.ok) {
    return {
      status: STATUS.FAIL,
      detail: `${res.status} (${fmtMs(Date.now() - start)}) — ${JSON.stringify(body).slice(0, 180)}`,
    };
  }

  return { status: STATUS.PASS, detail: `ok (${fmtMs(Date.now() - start)})` };
}

async function testAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { status: STATUS.SKIP, detail: "ANTHROPIC_API_KEY not set" };

  const start = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
      max_tokens: 10,
      messages: [{ role: "user", content: "Reply with the word ok." }],
    }),
    signal: AbortSignal.timeout(15000),
  });

  const body = parseJsonSafe(await res.text());
  if (!res.ok) {
    return {
      status: STATUS.FAIL,
      detail: `${res.status} (${fmtMs(Date.now() - start)}) — ${JSON.stringify(body).slice(0, 180)}`,
    };
  }

  return { status: STATUS.PASS, detail: `ok (${fmtMs(Date.now() - start)})` };
}

async function testShopify() {
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  const store = process.env.SHOPIFY_STORE;

  if (!token || !store) {
    return { status: STATUS.SKIP, detail: "SHOPIFY_STORE/SHOPIFY_ADMIN_TOKEN not set" };
  }

  const start = Date.now();
  const baseStore = store.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const res = await fetch(`https://${baseStore}/admin/api/2024-10/shop.json`, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });

  const body = parseJsonSafe(await res.text());
  if (!res.ok) {
    return {
      status: STATUS.FAIL,
      detail: `${res.status} (${fmtMs(Date.now() - start)}) — ${JSON.stringify(body).slice(0, 180)}`,
    };
  }

  return { status: STATUS.PASS, detail: `ok (${fmtMs(Date.now() - start)})` };
}

async function testAmazon() {
  const clientId = process.env.LWA_CLIENT_ID;
  const clientSecret = process.env.LWA_CLIENT_SECRET;
  const refreshToken = process.env.LWA_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return { status: STATUS.SKIP, detail: "LWA_CLIENT_ID/LWA_CLIENT_SECRET/LWA_REFRESH_TOKEN not set" };
  }

  const start = Date.now();
  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(15000),
  });

  const body = parseJsonSafe(await res.text());
  if (!res.ok || !(body && typeof body === "object" && body.access_token)) {
    return {
      status: STATUS.FAIL,
      detail: `${res.status} (${fmtMs(Date.now() - start)}) — ${JSON.stringify(body).slice(0, 180)}`,
    };
  }

  return { status: STATUS.PASS, detail: `ok (${fmtMs(Date.now() - start)})` };
}

async function testGA4() {
  const hasCreds =
    process.env.GA4_SERVICE_ACCOUNT_JSON || process.env.GA4_SERVICE_ACCOUNT_PATH;
  if (!hasCreds || !process.env.GA4_PROPERTY_ID) {
    return { status: STATUS.SKIP, detail: "GA4 credentials/property not set" };
  }

  const result = await httpTest({
    method: "GET",
    path: "/api/ops/abra/ga4?period=yesterday",
    auth: true,
  });

  return {
    status: result.status,
    detail: result.detail,
  };
}

async function runExternalChecks() {
  const checks = [
    ["OpenAI embeddings", testOpenAIEmbedding],
    ["Anthropic Claude", testAnthropic],
    ["Shopify Admin", testShopify],
    ["Amazon SP-API", testAmazon],
    ["GA4 Analytics", testGA4],
  ];

  for (const [label, fn] of checks) {
    try {
      const outcome = await fn();
      mark("external", {
        label,
        status: outcome.status,
        detail: outcome.detail,
      });
    } catch (error) {
      mark("external", {
        label,
        status: STATUS.FAIL,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function renderSection(title, rows) {
  const lines = [title];
  for (const row of rows) {
    const dots = ".".repeat(Math.max(2, 34 - row.label.length));
    lines.push(`  ${icon(row.status, row.warn)} ${row.label} ${dots} ${row.detail}`);
  }
  return lines.join("\n");
}

function aggregateSummary() {
  const all = Object.values(sections).flat();
  const passed = all.filter((r) => r.status === STATUS.PASS).length;
  const failed = all.filter((r) => r.status === STATUS.FAIL).length;
  const skipped = all.filter((r) => r.status === STATUS.SKIP).length;
  const considered = passed + failed;
  const ratio = considered > 0 ? passed / considered : 0;
  return { passed, failed, skipped, total: all.length, ratio };
}

async function sendSlackSummary(summaryText) {
  const webhook = process.env.SLACK_SUPPORT_WEBHOOK_URL;
  if (!webhook) return;

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: summaryText }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // best-effort
  }
}

async function main() {
  await runHealthChecks();
  await runFeedChecks();
  await runSupabaseChecks();
  await runExternalChecks();

  const summary = aggregateSummary();
  const header = [
    "═══════════════════════════════════════════",
    `  ABRA V2 SMOKE TEST — ${nowIso()}`,
    "═══════════════════════════════════════════",
    "",
  ];

  const body = [
    renderSection("ENDPOINT HEALTH:", sections.endpoint),
    "",
    renderSection("FEED TESTS:", sections.feed),
    "",
    renderSection("SUPABASE TABLES:", sections.supabase),
    "",
    renderSection("EXTERNAL APIS:", sections.external),
    "",
    `SUMMARY: ${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.skipped} skipped`,
    "═══════════════════════════════════════════",
  ];

  const output = header.concat(body).join("\n");
  console.log(output);

  await sendSlackSummary(
    `Abra smoke test: ${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.skipped} skipped (${BASE_URL})`,
  );

  process.exitCode = summary.ratio >= 0.8 ? 0 : 1;
}

main().catch((error) => {
  console.error("[abra-smoke-test] Unhandled error:", error);
  process.exitCode = 1;
});
