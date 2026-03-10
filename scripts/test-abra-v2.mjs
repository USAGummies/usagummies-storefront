#!/usr/bin/env node

/**
 * Abra v2 integration smoke suite.
 * Usage:
 *   node scripts/test-abra-v2.mjs [base_url]
 * Optional auth:
 *   ABRA_TEST_COOKIE='next-auth.session-token=...' node scripts/test-abra-v2.mjs
 */

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const AUTH_COOKIE = process.env.ABRA_TEST_COOKIE || "";
const AUTH_BEARER = process.env.ABRA_TEST_BEARER || "";

const ctx = {
  initiativeId: null,
  sessionId: null,
};

function authHeaders() {
  const headers = {};
  if (AUTH_COOKIE) headers.Cookie = AUTH_COOKIE;
  if (AUTH_BEARER) headers.Authorization = `Bearer ${AUTH_BEARER}`;
  return headers;
}

function isAuthError(status) {
  return status === 401 || status === 403;
}

async function req(path, init = {}) {
  const url = `${BASE}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...authHeaders(),
    ...(init.headers || {}),
  };

  const res = await fetch(url, {
    ...init,
    headers,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return { ok: res.ok, status: res.status, data, text, url };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function testHealth() {
  const res = await req("/");
  assert(res.status === 200, `Expected 200, got ${res.status}`);
}

async function testChatBasic() {
  const res = await req("/api/ops/abra/chat", {
    method: "POST",
    body: JSON.stringify({ message: "What can you help with today?" }),
  });

  if (isAuthError(res.status)) return;
  assert(res.status === 200, `Expected 200 or auth error, got ${res.status}`);
  assert(typeof res.data?.reply === "string", "Missing reply string");
}

async function testChatTiered() {
  const res = await req("/api/ops/abra/chat", {
    method: "POST",
    body: JSON.stringify({ message: "What distributor pricing signals do we have?" }),
  });

  if (isAuthError(res.status)) return;
  assert(res.status === 200, `Expected 200 or auth error, got ${res.status}`);
  assert(Array.isArray(res.data?.sources), "Expected sources array");
}

async function testCostEndpoint() {
  const res = await req("/api/ops/abra/cost");

  if (isAuthError(res.status)) return;
  assert(res.status === 200, `Expected 200 or auth error, got ${res.status}`);
  assert(typeof res.data?.total === "number", "Expected cost total number");
}

async function testAccuracyReport() {
  const res = await req("/api/ops/abra/accuracy?days=7");
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(typeof res.data?.overall === "object", "Expected accuracy report payload");
}

async function testDepartmentState() {
  const res = await req("/api/ops/department/finance");

  if (isAuthError(res.status)) return;
  assert(res.status === 200, `Expected 200 or auth error, got ${res.status}`);
  assert(typeof res.data?.generated_at === "string", "Expected generated_at");
}

async function testInitiativeCreate() {
  const res = await req("/api/ops/abra/initiative", {
    method: "POST",
    body: JSON.stringify({ department: "finance", goal: "Improve month-end close speed" }),
  });

  if (isAuthError(res.status)) return;
  assert(res.status === 200, `Expected 200 or auth error, got ${res.status}`);
  assert(typeof res.data?.id === "string", "Expected initiative id");
  ctx.initiativeId = res.data.id;
}

async function testInitiativeAnswer() {
  if (!ctx.initiativeId) {
    if (!AUTH_COOKIE && !AUTH_BEARER) return;
    throw new Error("No initiative id available from creation step");
  }

  const res = await req("/api/ops/abra/initiative", {
    method: "PATCH",
    body: JSON.stringify({
      id: ctx.initiativeId,
      answers: {
        accounting_basis: "accrual",
        fiscal_year: "calendar",
      },
    }),
  });

  if (isAuthError(res.status)) return;
  assert(res.status === 200, `Expected 200 or auth error, got ${res.status}`);
  assert(typeof res.data?.initiative === "object", "Expected initiative response");
}

async function testSessionCreate() {
  const res = await req("/api/ops/abra/session", {
    method: "POST",
    body: JSON.stringify({ department: "operations", session_type: "meeting" }),
  });

  if (isAuthError(res.status)) return;
  assert(res.status === 200, `Expected 200 or auth error, got ${res.status}`);
  assert(typeof res.data?.id === "string", "Expected session id");
  ctx.sessionId = res.data.id;
}

async function testSessionEnd() {
  if (!ctx.sessionId) {
    if (!AUTH_COOKIE && !AUTH_BEARER) return;
    throw new Error("No session id available from create step");
  }

  const res = await req("/api/ops/abra/session?action=end", {
    method: "POST",
    body: JSON.stringify({ id: ctx.sessionId }),
  });

  if (isAuthError(res.status)) return;
  assert(res.status === 200, `Expected 200 or auth error, got ${res.status}`);
  assert(res.data?.status === "completed", "Expected completed session status");
}

async function testDashboardConfig() {
  const res = await req("/api/ops/abra/dashboard-config", {
    method: "POST",
    body: JSON.stringify({
      department: "finance",
      changes: {
        add_widget: { id: "test_widget_abra_v2", title: "Test Widget" },
      },
    }),
  });

  if (isAuthError(res.status)) return;
  assert(res.status === 200, `Expected 200 or auth error, got ${res.status}`);
  assert(typeof res.data?.dashboard_config === "object", "Expected dashboard_config object");
}

async function testSignals() {
  const res = await req("/api/ops/abra/chat", {
    method: "POST",
    body: JSON.stringify({ message: "Any operational signals I should know?" }),
  });

  if (isAuthError(res.status)) return;
  assert(res.status === 200, `Expected 200 or auth error, got ${res.status}`);
  assert(typeof res.data?.reply === "string", "Expected reply text");
}

async function testPlaybookFetch() {
  const res = await req("/api/ops/abra/playbooks?department=finance");

  if (isAuthError(res.status)) return;
  assert(res.status === 200, `Expected 200 or auth error, got ${res.status}`);
  assert(typeof res.data?.playbook === "object", "Expected playbook payload");
}

const tests = [
  { name: "Health check", fn: testHealth },
  { name: "Chat basic", fn: testChatBasic },
  { name: "Chat with tiered memory", fn: testChatTiered },
  { name: "Cost endpoint", fn: testCostEndpoint },
  { name: "Accuracy report", fn: testAccuracyReport },
  { name: "Department state", fn: testDepartmentState },
  { name: "Initiative create", fn: testInitiativeCreate },
  { name: "Initiative answer", fn: testInitiativeAnswer },
  { name: "Session create", fn: testSessionCreate },
  { name: "Session end", fn: testSessionEnd },
  { name: "Dashboard config", fn: testDashboardConfig },
  { name: "Operational signals", fn: testSignals },
  { name: "Playbook fetch", fn: testPlaybookFetch },
];

(async () => {
  console.log(`Running Abra v2 test suite against ${BASE}`);
  const results = [];

  for (const test of tests) {
    const start = Date.now();
    try {
      await test.fn();
      const ms = Date.now() - start;
      results.push({ name: test.name, ok: true, ms });
      console.log(`✅ ${test.name} (${ms}ms)`);
    } catch (error) {
      const ms = Date.now() - start;
      const message = error instanceof Error ? error.message : String(error);
      results.push({ name: test.name, ok: false, ms, error: message });
      console.log(`❌ ${test.name} (${ms}ms) — ${message}`);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  console.log("\nSummary");
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
})();
