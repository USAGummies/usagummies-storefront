#!/usr/bin/env node
/**
 * Smoke test for the OpenAI / ChatGPT workspace connector.
 *
 * Read-only by default:
 *   - GET MCP discovery
 *   - POST tools/list
 *   - POST search
 *   - POST fetch
 *
 * Optional approval-request smoke:
 *   OPENAI_WORKSPACE_SMOKE_APPROVAL_TOOL=request_receipt_review_approval
 *   OPENAI_WORKSPACE_SMOKE_APPROVAL_ARG=rcpt-...
 *
 * The optional approval smoke opens a real Slack approval. Do not set
 * those env vars unless that is intentional.
 */

const baseUrl = (
  process.env.OPENAI_WORKSPACE_BASE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://www.usagummies.com"
).replace(/\/+$/, "");

const secret = process.env.OPENAI_WORKSPACE_CONNECTOR_SECRET?.trim();

if (!secret) {
  console.error(
    "Missing OPENAI_WORKSPACE_CONNECTOR_SECRET. Set it locally to the same value configured in Vercel.",
  );
  process.exit(1);
}

const endpoint = `${baseUrl}/api/ops/openai-workspace-tools/mcp`;

async function call(label, init) {
  const res = await fetch(endpoint, {
    ...init,
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${label}: non-JSON response (${res.status}) ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`${label}: HTTP ${res.status} ${JSON.stringify(json).slice(0, 500)}`);
  }
  return json;
}

function parseMcpText(response) {
  const content = response?.result?.content;
  if (!Array.isArray(content) || content[0]?.type !== "text") {
    throw new Error(`Unexpected MCP content envelope: ${JSON.stringify(response).slice(0, 500)}`);
  }
  return JSON.parse(content[0].text);
}

async function main() {
  console.log(`OpenAI workspace connector smoke: ${endpoint}`);

  const discovery = await call("GET discovery", { method: "GET" });
  const toolNames = (discovery.tools || []).map((t) => t.name).sort();
  for (const required of ["search", "fetch"]) {
    if (!toolNames.includes(required)) {
      throw new Error(`Discovery missing required tool: ${required}`);
    }
  }
  console.log(`GET discovery ok (${toolNames.length} tools)`);

  const list = await call("tools/list", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: "list", method: "tools/list" }),
  });
  const listed = (list.result?.tools || []).map((t) => t.name).sort();
  if (!listed.includes("search") || !listed.includes("fetch")) {
    throw new Error(`tools/list missing search/fetch: ${listed.join(", ")}`);
  }
  console.log(`tools/list ok (${listed.join(", ")})`);

  const search = await call("search", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "search",
      method: "tools/call",
      params: { name: "search", arguments: { query: "sales readiness receipt" } },
    }),
  });
  const searchPayload = parseMcpText(search);
  const first = searchPayload.results?.[0];
  if (!first?.id) {
    throw new Error(`search returned no results: ${JSON.stringify(searchPayload)}`);
  }
  console.log(`search ok (${searchPayload.results.length} results, first=${first.id})`);

  const fetchResult = await call("fetch", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "fetch",
      method: "tools/call",
      params: { name: "fetch", arguments: { id: first.id } },
    }),
  });
  const fetchPayload = parseMcpText(fetchResult);
  if (fetchPayload.id !== first.id || !fetchPayload.text || !fetchPayload.metadata) {
    throw new Error(`fetch returned malformed payload: ${JSON.stringify(fetchPayload).slice(0, 500)}`);
  }
  console.log(`fetch ok (${fetchPayload.id}, mode=${fetchPayload.metadata.mode})`);

  const approvalTool = process.env.OPENAI_WORKSPACE_SMOKE_APPROVAL_TOOL?.trim();
  const approvalArg = process.env.OPENAI_WORKSPACE_SMOKE_APPROVAL_ARG?.trim();
  if (approvalTool || approvalArg) {
    if (!approvalTool || !approvalArg) {
      throw new Error(
        "Both OPENAI_WORKSPACE_SMOKE_APPROVAL_TOOL and OPENAI_WORKSPACE_SMOKE_APPROVAL_ARG are required for approval smoke.",
      );
    }
    const args =
      approvalTool === "request_receipt_review_approval"
        ? { receiptId: approvalArg }
        : { id: approvalArg, requestedBy: "openai-workspace-smoke" };
    const approval = await call("approval request", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "approval",
        method: "tools/call",
        params: { name: approvalTool, arguments: args },
      }),
    });
    const approvalPayload = parseMcpText(approval);
    if (!approvalPayload.ok) {
      throw new Error(
        `approval request failed: ${JSON.stringify(approvalPayload).slice(0, 700)}`,
      );
    }
    console.log(`approval request ok (${approvalTool})`);
  }

  console.log("OpenAI workspace connector smoke passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
