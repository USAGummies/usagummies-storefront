import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";

type DeployFileChange = {
  path: string;
  content?: string;
  action: "create" | "modify" | "delete";
};

type DeployRequest = {
  files?: unknown;
  description?: unknown;
  commit_message?: unknown;
};

type AgentRow = { id: string };
type ApprovalInsertRow = { id: string; status: string };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES = 50;
const MAX_CONTENT_BYTES_PER_FILE = 200_000;

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

function normalizeFiles(files: unknown): DeployFileChange[] {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("files is required and must be a non-empty array");
  }

  if (files.length > MAX_FILES) {
    throw new Error(`files exceeds max (${MAX_FILES})`);
  }

  return files.map((raw, idx) => {
    if (!raw || typeof raw !== "object") {
      throw new Error(`files[${idx}] must be an object`);
    }

    const item = raw as Record<string, unknown>;
    const filePath = typeof item.path === "string" ? item.path.trim() : "";
    const action = item.action;
    const content = typeof item.content === "string" ? item.content : undefined;

    if (!filePath) {
      throw new Error(`files[${idx}].path is required`);
    }

    if (action !== "create" && action !== "modify" && action !== "delete") {
      throw new Error(`files[${idx}].action must be create|modify|delete`);
    }

    if (action !== "delete") {
      if (typeof content !== "string") {
        throw new Error(`files[${idx}].content is required for create/modify`);
      }
      if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES_PER_FILE) {
        throw new Error(`files[${idx}].content exceeds ${MAX_CONTENT_BYTES_PER_FILE} bytes`);
      }
    }

    return {
      path: filePath,
      action,
      content,
    };
  });
}

async function resolveAbraAgentId() {
  const rows = (await sbFetch("/rest/v1/agents?select=id&agent_name=eq.Abra&limit=1")) as AgentRow[];
  if (!rows[0]?.id) {
    throw new Error("Abra agent not found in agents table");
  }
  return rows[0].id;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  let payload: DeployRequest = {};
  try {
    payload = (await req.json()) as DeployRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const description = typeof payload.description === "string" ? payload.description.trim() : "";
  const commitMessage = typeof payload.commit_message === "string" ? payload.commit_message.trim() : "";

  if (!commitMessage) {
    return NextResponse.json({ error: "commit_message is required" }, { status: 400 });
  }

  let files: DeployFileChange[] = [];
  try {
    files = normalizeFiles(payload.files);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid files payload" },
      { status: 400 },
    );
  }

  try {
    const requestingAgentId = await resolveAbraAgentId();
    const requestedAt = new Date().toISOString();
    const proposedPayload = {
      kind: "code_deploy_v1",
      files,
      commit_message: commitMessage,
      description,
      requested_by: session.user.email,
      requested_at: requestedAt,
    };

    const supportSummary = {
      file_count: files.length,
      paths: files.map((f) => f.path),
      commit_message: commitMessage,
      requested_by: session.user.email,
      requested_at: requestedAt,
    };

    const rows = (await sbFetch("/rest/v1/approvals", {
      method: "POST",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        requesting_agent_id: requestingAgentId,
        action_type: "data_mutation",
        target_entity_type: "codebase",
        target_entity_id: null,
        summary: (description || `Code deploy request: ${commitMessage}`).slice(0, 500),
        supporting_data: JSON.stringify(supportSummary),
        proposed_payload: proposedPayload,
        confidence: "medium",
        risk_level: "high",
        permission_tier: 3,
        status: "pending",
        approval_trigger: "commitment",
        action_proposed: commitMessage,
        confidence_level: 0.7,
        risk_assessment: "Code change + git push to main after explicit human approval.",
      }),
    })) as ApprovalInsertRow[];

    const created = rows[0];
    if (!created?.id) {
      throw new Error("Approval insert returned no row");
    }

    return NextResponse.json({
      approval_id: created.id,
      status: "pending_approval",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create approval" },
      { status: 500 },
    );
  }
}
