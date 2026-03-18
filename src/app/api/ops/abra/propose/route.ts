/**
 * POST /api/ops/abra/propose — Abra submits proposals for human approval
 *
 * Body: {
 *   action_type: string,
 *   description: string,
 *   details: Record<string,any>,
 *   confidence: number (0-1),
 *   risk_level: 'low'|'medium'|'high'
 * }
 * Returns: { approval_id: string, status: 'pending' }
 *
 * Proposals appear in /ops/permissions for human review.
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  canUseSupabase,
  markSupabaseFailure,
  markSupabaseSuccess,
} from "@/lib/ops/supabase-resilience";
import { notify } from "@/lib/ops/notify";
import { validateRequest, ProposeRequestSchema } from "@/lib/ops/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const VALID_RISK_LEVELS = new Set(["low", "medium", "high"]);

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}) {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

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
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }

  return json;
}

function isSupabaseRelatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /supabase|rest\/v1|service_role|SUPABASE/i.test(message);
}

/**
 * Get or create the 'abra' agent row in the agents table.
 * Returns the agent UUID.
 */
async function resolveAbraAgentId(): Promise<string> {
  const rows = (await sbFetch(
    "/rest/v1/agents?select=id&agent_name=eq.abra&limit=1",
  )) as Array<{ id: string }>;

  if (rows[0]?.id) return rows[0].id;

  // Auto-create the abra agent entry
  const created = (await sbFetch("/rest/v1/agents", {
    method: "POST",
    headers: {
      Prefer: "return=representation",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      agent_name: "abra",
      agent_type: "ai",
      department: "systems",
      owner: "system",
      description: "Abra OS autonomous AI operations assistant",
      is_active: true,
    }),
  })) as Array<{ id: string }>;

  if (!created[0]?.id) {
    throw new Error("Failed to create abra agent record");
  }

  return created[0].id;
}

function confidenceToLabel(value: number): "high" | "medium" | "low" {
  if (value >= 0.75) return "high";
  if (value >= 0.4) return "medium";
  return "low";
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const v = await validateRequest(req, ProposeRequestSchema);
  if (!v.success) return v.response;

  const actionType = v.data.action_type;
  const description = v.data.description;
  const details = v.data.details;
  const confidence = v.data.confidence;
  const riskLevel = v.data.risk_level;

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        { error: "Brain temporarily unavailable (circuit open)" },
        { status: 503 },
      );
    }

    const abraAgentId = await resolveAbraAgentId();

    // Determine permission tier based on risk
    const permissionTier = riskLevel === "high" ? 3 : riskLevel === "medium" ? 2 : 1;

    const rows = (await sbFetch("/rest/v1/approvals", {
      method: "POST",
      headers: {
        Prefer: "return=representation",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requesting_agent_id: abraAgentId,
        action_type: actionType,
        summary: description,
        supporting_data: JSON.stringify(details).slice(0, 5000),
        confidence: confidenceToLabel(confidence),
        risk_level: riskLevel,
        permission_tier: permissionTier,
        status: "pending",
        approval_trigger: "abra_proposal",
        action_proposed: description,
        confidence_level: confidence,
        risk_assessment: riskLevel,
      }),
    })) as Array<{ id: string; status: string }>;

    const created = rows[0];
    if (!created?.id) {
      throw new Error("Failed to create approval record");
    }

    await markSupabaseSuccess();

    void notify({
      channel: "alerts",
      text: `📝 Abra approval request: ${description}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `📝 *Abra Approval Request*\n` +
              `*Action:* ${actionType}\n` +
              `*Summary:* ${description}\n` +
              `*Risk:* ${riskLevel} | *Confidence:* ${confidenceToLabel(confidence)}\n` +
              `*Approval ID:* ${created.id}`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "✅ Approve" },
              style: "primary",
              action_id: "approve_action",
              value: created.id,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "❌ Reject" },
              style: "danger",
              action_id: "reject_action",
              value: created.id,
            },
          ],
        },
      ],
    }).catch(() => {});

    return NextResponse.json({
      approval_id: created.id,
      status: "pending",
      risk_level: riskLevel,
      confidence: confidenceToLabel(confidence),
      permission_tier: permissionTier,
    });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }
    const message = error instanceof Error ? error.message : "Proposal failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
