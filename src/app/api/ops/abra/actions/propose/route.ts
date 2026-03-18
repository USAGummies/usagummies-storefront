import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  proposeAction,
  proposeAndMaybeExecute,
  requiresExplicitPermission,
  type AbraAction,
} from "@/lib/ops/abra-actions";
import { validateRequest, ActionsProposeSchema } from "@/lib/ops/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Match abra-actions.ts: default to OFF — auto-execution must be explicitly opted into */
function isAutoExecutionEnabled(): boolean {
  const raw = String(process.env.ABRA_AUTO_EXEC_ENABLED || "").trim().toLowerCase();
  if (!raw) return false;
  return ["1", "true", "on", "yes"].includes(raw);
}

type ProposePayload = {
  department?: unknown;
  action_type?: unknown;
  title?: unknown;
  description?: unknown;
  params?: unknown;
  risk_level?: unknown;
  confidence?: unknown;
  auto_execute?: unknown;
};

function parseRisk(value: unknown): AbraAction["risk_level"] {
  if (
    value === "critical" ||
    value === "high" ||
    value === "medium" ||
    value === "low"
  ) {
    return value;
  }
  return "medium";
}

function mapActionType(
  actionType: string,
  title: string,
  description: string,
  params: Record<string, unknown>,
): {
  actionType: string;
  params: Record<string, unknown>;
  risk?: AbraAction["risk_level"];
} {
  const normalized = actionType.trim().toLowerCase();
  if (normalized === "log_insight") {
    return {
      actionType: "create_brain_entry",
      params: {
        title: title || "Insight",
        text: description || String(params.text || params.content || ""),
        ...params,
      },
      risk: "low",
    };
  }

  return {
    actionType: normalized,
    params,
  };
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const v = await validateRequest(req, ActionsProposeSchema);
  if (!v.success) return v.response;

  const department = v.data.department;
  const actionTypeRaw = v.data.action_type;
  const title = v.data.title;
  const description = v.data.description;
  const params = v.data.params;
  const confidence = v.data.confidence;
  const autoExecuteRequested = v.data.auto_execute;
  const requestedRisk = parseRisk(v.data.risk_level);

  const mapped = mapActionType(actionTypeRaw, title, description, params);
  const action: AbraAction = {
    action_type: mapped.actionType,
    title,
    description,
    department,
    risk_level: mapped.risk || requestedRisk,
    params: mapped.params,
    requires_approval: true,
    confidence,
  };

  const permissionRequired = requiresExplicitPermission(action.action_type);
  const autoExecutionEnabled = isAutoExecutionEnabled();
  const autoExecute =
    autoExecuteRequested && autoExecutionEnabled && !permissionRequired;

  try {
    if (autoExecute) {
      const result = await proposeAndMaybeExecute(action);
      return NextResponse.json(
        {
          ok: true,
          approval_id: result.approval_id,
          auto_executed: result.auto_executed,
          permission_required: false,
          result: result.result || null,
        },
        { status: 200 },
      );
    }

    const status = await proposeAction(action);
    const approvalId = status.startsWith("queued:") ? status.slice("queued:".length) : status;
    return NextResponse.json(
      {
        ok: true,
        approval_id: approvalId,
        status: "pending",
        auto_executed: false,
        permission_required: permissionRequired,
        ...(!autoExecutionEnabled && autoExecuteRequested
          ? { note: "Auto-execution is globally disabled by policy." }
          : permissionRequired && autoExecuteRequested
            ? { note: "External submissions require explicit approval." }
            : {}),
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to propose action" },
      { status: 500 },
    );
  }
}
