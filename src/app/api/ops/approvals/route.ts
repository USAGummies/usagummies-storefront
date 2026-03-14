import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { auth } from "@/lib/auth/config";
import { readState, writeState } from "@/lib/ops/state";
import {
  canUseSupabase,
  isCircuitOpen,
  markSupabaseFailure,
  markSupabaseSuccess,
} from "@/lib/ops/supabase-resilience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_DECISIONS = new Set(["approved", "denied", "modified"]);
const APPROVALS_CACHE_TTL = 10 * 60 * 1000;
const APPROVALS_STALE_MAX_AGE = 24 * 60 * 60 * 1000;

type ApprovalRow = {
  id: string;
  requesting_agent_id: string;
  action_type: string;
  target_entity_type: string | null;
  target_entity_id: string | null;
  summary: string;
  supporting_data: string | null;
  confidence: "high" | "medium" | "low" | null;
  risk_level: "low" | "medium" | "high" | "critical" | null;
  permission_tier: number | null;
  status: string;
  requested_at: string;
  approval_trigger: string | null;
  action_proposed: string | null;
  confidence_level: number | null;
  risk_assessment: string | null;
  affected_departments?: string[] | null;
  proposed_payload?: unknown;
  resolved_payload?: unknown;
};

type AgentRow = {
  id: string;
  agent_name: string;
  department: string | null;
};

type EnrichedApproval = ApprovalRow & {
  agent_name: string;
  agent_department: string | null;
};

type ProcessPayload = {
  approvalId?: string;
  decision?: "approved" | "denied" | "modified";
  reasoning?: string | null;
  modificationNotes?: string | null;
};

type ApprovalsPayload = {
  approvals: EnrichedApproval[];
  totalPending: number;
  generatedAt: string;
};

type CacheEnvelope<T> = {
  data: T;
  cachedAt: number;
};

type DeployFileChange = {
  path: string;
  content?: string;
  action: "create" | "modify" | "delete";
};

type DeployPayload = {
  kind: "code_deploy_v1";
  files: DeployFileChange[];
  commit_message: string;
  description?: string;
  requested_by?: string;
  requested_at?: string;
};

type DeployExecutionResult = {
  kind: "code_deploy_v1";
  ok: boolean;
  commitSha?: string;
  changedFiles?: string[];
  noChanges?: boolean;
  error?: string;
};

function isSupabaseRelatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /supabase|rest\/v1|service_role|SUPABASE/i.test(message);
}

function isDeployPayload(payload: unknown): payload is DeployPayload {
  if (!payload || typeof payload !== "object") return false;
  const data = payload as Record<string, unknown>;
  if (data.kind !== "code_deploy_v1") return false;
  if (!Array.isArray(data.files) || data.files.length === 0) return false;
  if (typeof data.commit_message !== "string" || data.commit_message.trim().length === 0) return false;
  return true;
}

function executeDeployPayload(payload: DeployPayload): DeployExecutionResult {
  const scriptPath = path.join(process.cwd(), "scripts/abra-deploy.mjs");
  const result = spawnSync("node", [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    input: JSON.stringify(payload),
    timeout: 180000,
  });

  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();

  let parsed: unknown = null;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch {
      parsed = null;
    }
  }

  if (parsed && typeof parsed === "object" && "kind" in parsed && (parsed as { kind?: unknown }).kind === "code_deploy_v1") {
    const response = parsed as DeployExecutionResult;
    if (response.ok) return response;
  }

  const message = [
    result.error?.message || "",
    stderr,
    stdout,
    result.status !== null ? `exit ${result.status}` : "",
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 500);

  return {
    kind: "code_deploy_v1",
    ok: false,
    error: message || "Deploy execution failed",
  };
}

async function readApprovalsCache(maxAgeMs = APPROVALS_CACHE_TTL): Promise<(ApprovalsPayload & {
  cacheAgeMinutes: number;
}) | null> {
  const cached = await readState<CacheEnvelope<ApprovalsPayload> | null>("approvals-cache", null);
  if (!cached) return null;

  const ageMs = Date.now() - cached.cachedAt;
  if (ageMs > maxAgeMs) return null;

  return {
    ...cached.data,
    cacheAgeMinutes: Math.max(0, Math.round(ageMs / 60000)),
  };
}

async function writeApprovalsCache(data: ApprovalsPayload): Promise<void> {
  await writeState("approvals-cache", { data, cachedAt: Date.now() });
}

async function tryWebhookDecision(input: {
  approvalId: string;
  decision: "approved" | "denied" | "modified";
  reasoning: string;
  modificationNotes: string;
  decidedByEmail: string;
}) {
  const webhookUrl =
    process.env.N8N_APPROVAL_WEBHOOK_URL ||
    process.env.NEXT_PUBLIC_APPROVAL_WEBHOOK_URL;

  if (!webhookUrl) return null;

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      approval_id: input.approvalId,
      decision: input.decision,
      reasoning: input.reasoning || null,
      modification_notes: input.modificationNotes || null,
      decided_by_email: input.decidedByEmail,
    }),
  });

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    throw new Error(
      `Approval webhook failed (${res.status}): ${
        typeof payload === "string" ? payload : JSON.stringify(payload)
      }`,
    );
  }

  return payload;
}

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!baseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}) {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  headers.set("Content-Type", "application/json");

  const res = await fetch(`${baseUrl}${path}`, {
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
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`);
  }

  return json;
}

function compact<T>(arr: Array<T | null | undefined>): T[] {
  return arr.filter((v): v is T => v != null);
}

async function resolveDeciderUserId(email: string | null | undefined): Promise<string> {
  if (!email) {
    throw new Error("Authenticated session missing email");
  }

  const encoded = encodeURIComponent(email.toLowerCase());
  const rows = (await sbFetch(`/rest/v1/users?select=id,email&email=eq.${encoded}&limit=1`)) as Array<{ id: string; email: string }>;
  if (!rows[0]?.id) {
    throw new Error(`No matching Supabase user found for session email: ${email}`);
  }

  return rows[0].id;
}

async function fetchPendingApprovals(): Promise<ApprovalsPayload> {
  const approvals = (await sbFetch(
    "/rest/v1/approvals?select=id,requesting_agent_id,action_type,target_entity_type,target_entity_id,summary,supporting_data,confidence,risk_level,permission_tier,status,requested_at,approval_trigger,action_proposed,confidence_level,risk_assessment&status=eq.pending&order=permission_tier.desc,requested_at.asc&limit=100",
  )) as ApprovalRow[];

  const agentIds = Array.from(new Set(compact(approvals.map((a) => a.requesting_agent_id))));
  const agentsById = new Map<string, AgentRow>();

  if (agentIds.length > 0) {
    const agentFilter = encodeURIComponent(`(${agentIds.join(",")})`);
    const agents = (await sbFetch(
      `/rest/v1/agents?select=id,agent_name,department&id=in.${agentFilter}`,
    )) as AgentRow[];

    for (const agent of agents) {
      agentsById.set(agent.id, agent);
    }
  }

  const enriched = approvals.map((approval) => {
    const agent = agentsById.get(approval.requesting_agent_id);
    return {
      ...approval,
      agent_name: agent?.agent_name || "Unknown Agent",
      agent_department: agent?.department || null,
    };
  });

  return {
    approvals: enriched,
    totalPending: enriched.length,
    generatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      const cached = await readApprovalsCache(APPROVALS_STALE_MAX_AGE);
      if (cached) {
        return NextResponse.json({
          ...cached,
          degraded: true,
          source: "cache",
          circuitOpen: true,
          cacheAgeMinutes: cached.cacheAgeMinutes,
        });
      }

      return NextResponse.json(
        {
          error: "Supabase dependency is temporarily unavailable (circuit open)",
          circuitOpen: true,
          cooldownUntil: circuitCheck.state.cooldownUntil,
        },
        { status: 503 },
      );
    }

    const payload = await fetchPendingApprovals();
    await writeApprovalsCache(payload);
    await markSupabaseSuccess();

    return NextResponse.json({
      ...payload,
      degraded: false,
      source: "supabase",
      circuitOpen: false,
    });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      const state = await markSupabaseFailure(error);
      const cached = await readApprovalsCache(APPROVALS_STALE_MAX_AGE);
      if (cached) {
        return NextResponse.json({
          ...cached,
          degraded: true,
          source: "cache",
          circuitOpen: isCircuitOpen(state),
          cacheAgeMinutes: cached.cacheAgeMinutes,
          warning: "Serving cached approvals due to Supabase failure.",
        });
      }

      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "Failed to load approvals",
          circuitOpen: isCircuitOpen(state),
          cooldownUntil: state.cooldownUntil,
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load approvals" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = (await req.json()) as ProcessPayload;
    const approvalId = payload.approvalId;
    const decision = payload.decision;
    const reasoning = (payload.reasoning || "").trim();
    const modificationNotes = (payload.modificationNotes || "").trim();

    if (!approvalId || !decision || !VALID_DECISIONS.has(decision)) {
      return NextResponse.json({ error: "Invalid payload: approvalId and valid decision are required" }, { status: 400 });
    }

    if (decision === "denied" && !reasoning) {
      return NextResponse.json({ error: "Reasoning is required when denying an approval" }, { status: 400 });
    }

    const webhookResult = await tryWebhookDecision({
      approvalId,
      decision,
      reasoning,
      modificationNotes,
      decidedByEmail: session.user.email,
    });
    if (webhookResult) {
      return NextResponse.json({
        ok: true,
        mode: "webhook",
        result: webhookResult,
      });
    }

    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        {
          error: "Supabase dependency is temporarily unavailable (circuit open)",
          circuitOpen: true,
          cooldownUntil: circuitCheck.state.cooldownUntil,
        },
        { status: 503 },
      );
    }

    const deciderId = await resolveDeciderUserId(session.user.email);

    const approvalRows = (await sbFetch(
      `/rest/v1/approvals?select=id,requesting_agent_id,action_type,approval_trigger,summary,supporting_data,status,confidence,risk_level,affected_departments,proposed_payload&id=eq.${approvalId}&limit=1`,
    )) as ApprovalRow[];

    const approval = approvalRows[0];
    if (!approval) {
      return NextResponse.json({ error: "Approval not found" }, { status: 404 });
    }

    if (approval.status !== "pending") {
      return NextResponse.json({ error: "Approval already processed" }, { status: 409 });
    }

    const now = new Date().toISOString();

    const updatedRows = (await sbFetch(
      `/rest/v1/approvals?id=eq.${approvalId}&status=eq.pending`,
      {
        method: "PATCH",
        headers: {
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          status: decision,
          decision,
          decision_reasoning: reasoning || null,
          decided_by_user_id: deciderId,
          decided_at: now,
          updated_at: now,
        }),
      },
    )) as ApprovalRow[];

    const updated = updatedRows[0];
    if (!updated) {
      return NextResponse.json({ error: "Approval update conflict" }, { status: 409 });
    }

    const decisionLogRows = (await sbFetch("/rest/v1/decision_log", {
      method: "POST",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        approval_id: approval.id,
        requesting_agent_id: approval.requesting_agent_id,
        action_proposed: approval.summary,
        action_pattern: `${approval.action_type}_${approval.approval_trigger || "none"}`,
        supporting_data: approval.supporting_data,
        confidence_level: approval.confidence || null,
        cross_department_impact: Array.isArray(approval.affected_departments)
          ? approval.affected_departments.join(",")
          : null,
        risk_assessment: approval.risk_level || null,
        decision,
        reasoning: reasoning || null,
        modification_notes: modificationNotes || null,
        decided_by: deciderId,
      }),
    })) as Array<{ id: string }>;

    const decisionLogId = decisionLogRows[0]?.id || null;

    if (decision === "denied") {
      const denialRaw = `Decision denied for approval ${approval.id}. Proposed action: ${approval.summary}. Reasoning: ${reasoning}`;
      await sbFetch("/rest/v1/open_brain_entries", {
        method: "POST",
        headers: {
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          source_type: "agent",
          source_ref: `w06-denial-${approval.id}`,
          entry_type: "finding",
          title: `Decision Denied: ${approval.action_type}`,
          raw_text: denialRaw,
          summary_text: reasoning,
          category: "system_log",
          department: "systems",
          source_agent_id: approval.requesting_agent_id,
          confidence: "medium",
          priority: "normal",
          processed: true,
        }),
      });
    }

    let execution: DeployExecutionResult | null = null;
    if (decision === "approved" && isDeployPayload(approval.proposed_payload)) {
      execution = executeDeployPayload(approval.proposed_payload);

      await sbFetch(`/rest/v1/approvals?id=eq.${approval.id}`, {
        method: "PATCH",
        headers: {
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          resolved_payload: execution,
          updated_at: new Date().toISOString(),
        }),
      });
    }

    await markSupabaseSuccess();

    return NextResponse.json({
      ok: true,
      approvalId: approval.id,
      decision,
      decisionLogId,
      decidedAt: now,
      execution,
    });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      const state = await markSupabaseFailure(error);
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "Failed to process approval",
          circuitOpen: isCircuitOpen(state),
          cooldownUntil: state.cooldownUntil,
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process approval" },
      { status: 500 },
    );
  }
}
