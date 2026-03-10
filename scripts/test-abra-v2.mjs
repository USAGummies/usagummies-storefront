#!/usr/bin/env node
import { createHmac } from "node:crypto";

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
  approvalId: null,
  dependencyInitiativeId: null,
  documentId: null,
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

function skip(reason) {
  return { skipped: true, reason };
}

function isSkipped(result) {
  return (
    result &&
    typeof result === "object" &&
    result.skipped === true &&
    typeof result.reason === "string"
  );
}

async function reqRaw(path, init = {}) {
  const url = `${BASE}${path}`;
  const headers = {
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

async function testWeeklyDigest() {
  if (!process.env.CRON_SECRET) return skip("CRON_SECRET not configured");
  const res = await reqRaw("/api/ops/abra/digest?type=weekly", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.CRON_SECRET}`,
    },
  });
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(res.data?.ok === true, "Expected digest ok=true");
}

async function testApprovalList() {
  const res = await req("/api/ops/abra/approvals?status=pending");
  if (isAuthError(res.status)) return;
  assert(res.status === 200, `Expected 200 or auth error, got ${res.status}`);
  assert(Array.isArray(res.data?.approvals), "Expected approvals array");
}

async function testApprovalFlow() {
  const createRes = await req("/api/ops/abra/propose", {
    method: "POST",
    body: JSON.stringify({
      action_type: "config_change",
      description: "Test approval flow from integration suite",
      details: { source: "test-abra-v2" },
      confidence: 0.62,
      risk_level: "low",
    }),
  });

  if (isAuthError(createRes.status)) return;
  assert(createRes.status === 200, `Expected 200, got ${createRes.status}`);
  assert(typeof createRes.data?.approval_id === "string", "Expected approval_id");
  ctx.approvalId = createRes.data.approval_id;

  const approveRes = await req("/api/ops/abra/approvals", {
    method: "PATCH",
    body: JSON.stringify({
      id: ctx.approvalId,
      decision: "approved",
      comment: "integration suite auto-approve",
    }),
  });

  if (isAuthError(approveRes.status)) return;
  assert(approveRes.status === 200, `Expected 200, got ${approveRes.status}`);
  assert(
    typeof approveRes.data?.approval === "object",
    "Expected approval object after decision",
  );
}

async function testInitiativeHealth() {
  const res = await req("/api/ops/abra/initiative-health");
  if (isAuthError(res.status)) return;
  assert(res.status === 200, `Expected 200 or auth error, got ${res.status}`);
  assert(typeof res.data?.counts === "object", "Expected initiative health counts");
}

async function testDependencies() {
  if (!ctx.initiativeId) {
    if (!AUTH_COOKIE && !AUTH_BEARER) return;
    throw new Error("No primary initiative id available from prior test");
  }

  const createRes = await req("/api/ops/abra/initiative", {
    method: "POST",
    body: JSON.stringify({
      department: "operations",
      goal: "Dependency target initiative for integration test",
    }),
  });
  if (isAuthError(createRes.status)) return;
  assert(createRes.status === 200, `Expected 200, got ${createRes.status}`);
  assert(typeof createRes.data?.id === "string", "Expected dependency initiative id");
  ctx.dependencyInitiativeId = createRes.data.id;

  const linkRes = await req("/api/ops/abra/initiative", {
    method: "PATCH",
    body: JSON.stringify({
      id: ctx.initiativeId,
      add_dependency: {
        depends_on_id: ctx.dependencyInitiativeId,
        relationship_type: "blocks",
      },
    }),
  });
  if (isAuthError(linkRes.status)) return;
  assert(linkRes.status === 200, `Expected 200, got ${linkRes.status}`);

  const fetchRes = await req(
    `/api/ops/abra/initiative?id=${ctx.initiativeId}&include_dependencies=true`,
  );
  if (isAuthError(fetchRes.status)) return;
  assert(fetchRes.status === 200, `Expected 200, got ${fetchRes.status}`);
  const initiative = Array.isArray(fetchRes.data?.initiatives)
    ? fetchRes.data.initiatives[0]
    : null;
  assert(initiative && typeof initiative === "object", "Expected initiative result");
  assert(
    Array.isArray(initiative.blocked_by),
    "Expected blocked_by array on initiative with dependencies",
  );
}

async function testDocumentUpload() {
  const content = `Document test ${new Date().toISOString()}\nDistributor update: pricing changed.`;
  const form = new FormData();
  form.set("file", new File([content], "abra-test-upload.txt", { type: "text/plain" }));

  const res = await reqRaw("/api/ops/abra/ingest", {
    method: "POST",
    body: form,
  });
  if (isAuthError(res.status)) return;
  assert(res.status === 200, `Expected 200 or auth error, got ${res.status}`);
  assert(typeof res.data?.document_id === "string", "Expected document_id");
  ctx.documentId = res.data.document_id;
}

async function testDocumentList() {
  const res = await req("/api/ops/abra/ingest");
  if (isAuthError(res.status)) return;
  assert(res.status === 200, `Expected 200 or auth error, got ${res.status}`);
  assert(Array.isArray(res.data?.documents), "Expected documents array");
}

async function testEmailSignals() {
  const res = await req("/api/ops/abra/email-signals");
  if (isAuthError(res.status)) return;
  assert(res.status === 200, `Expected 200 or auth error, got ${res.status}`);
  assert(Array.isArray(res.data?.by_type), "Expected by_type signal buckets");
}

async function testNotionWrite() {
  if (!process.env.NOTION_API_KEY) return skip("NOTION_API_KEY not configured");
  if (!AUTH_COOKIE && !AUTH_BEARER) return skip("Auth required for session end Notion sync");

  const createRes = await req("/api/ops/abra/session", {
    method: "POST",
    body: JSON.stringify({ department: "executive", session_type: "meeting" }),
  });
  if (isAuthError(createRes.status)) return;
  assert(createRes.status === 200, `Expected 200, got ${createRes.status}`);
  assert(typeof createRes.data?.id === "string", "Expected session id");

  const endRes = await req("/api/ops/abra/session?action=end", {
    method: "POST",
    body: JSON.stringify({ id: createRes.data.id }),
  });
  if (isAuthError(endRes.status)) return;
  assert(endRes.status === 200, `Expected 200, got ${endRes.status}`);
  assert(endRes.data?.notion_sync === "scheduled", "Expected notion sync to be scheduled");
}

function slackSignature(body) {
  const secret = process.env.SLACK_SIGNING_SECRET || "";
  if (!secret) return null;
  const ts = Math.floor(Date.now() / 1000).toString();
  const base = `v0:${ts}:${body}`;
  const hash = createHmac("sha256", secret)
    .update(base)
    .digest("hex");
  return { ts, signature: `v0=${hash}` };
}

async function testSlackInteractions() {
  const payload = {
    type: "block_actions",
    user: { id: "U_TEST", username: "test-user", name: "test-user" },
    actions: [{ action_id: "feedback_positive", value: "00000000-0000-0000-0000-000000000000" }],
  };
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
  const sig = slackSignature(body);

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (sig) {
    headers["x-slack-request-timestamp"] = sig.ts;
    headers["x-slack-signature"] = sig.signature;
  }

  const res = await reqRaw("/api/ops/slack/interactions", {
    method: "POST",
    body,
    headers,
  });

  assert(res.status === 200, `Expected 200, got ${res.status}`);
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
  { name: "Weekly digest generation", fn: testWeeklyDigest },
  { name: "Approval list", fn: testApprovalList },
  { name: "Approval create + approve", fn: testApprovalFlow },
  { name: "Initiative health check", fn: testInitiativeHealth },
  { name: "Initiative dependencies", fn: testDependencies },
  { name: "Document upload", fn: testDocumentUpload },
  { name: "Document list", fn: testDocumentList },
  { name: "Email signal extraction", fn: testEmailSignals },
  { name: "Notion write (if configured)", fn: testNotionWrite },
  { name: "Slack interactions endpoint", fn: testSlackInteractions },
];

(async () => {
  console.log(`Running Abra v2 test suite against ${BASE}`);
  const results = [];

  for (const test of tests) {
    const start = Date.now();
    try {
      const maybeSkip = await test.fn();
      const ms = Date.now() - start;
      if (isSkipped(maybeSkip)) {
        results.push({ name: test.name, ok: null, ms, reason: maybeSkip.reason });
        console.log(`⏭️ ${test.name} (${ms}ms) — ${maybeSkip.reason}`);
      } else {
        results.push({ name: test.name, ok: true, ms });
        console.log(`✅ ${test.name} (${ms}ms)`);
      }
    } catch (error) {
      const ms = Date.now() - start;
      const message = error instanceof Error ? error.message : String(error);
      results.push({ name: test.name, ok: false, ms, error: message });
      console.log(`❌ ${test.name} (${ms}ms) — ${message}`);
    }
  }

  const passed = results.filter((r) => r.ok === true).length;
  const failed = results.filter((r) => r.ok === false).length;
  const skipped = results.filter((r) => r.ok === null).length;

  console.log("\n========================================");
  console.log("ABRA v2 PHASE 4-5 TEST RESULTS");
  console.log("========================================");
  console.log(`Total: ${results.length} tests`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ❌`);
  console.log(`Skipped: ${skipped}`);
  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const result of results.filter((r) => r.ok === false)) {
      console.log(`  - ${result.name}: ${result.error}`);
    }
  }
  if (skipped > 0) {
    console.log("\nSkipped tests:");
    for (const result of results.filter((r) => r.ok === null)) {
      console.log(`  - ${result.name}: ${result.reason}`);
    }
  }
  console.log("========================================");

  if (failed > 0) {
    process.exitCode = 1;
  }
})();
