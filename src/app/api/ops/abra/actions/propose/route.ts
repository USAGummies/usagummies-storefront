import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  proposeAction,
  proposeAndMaybeExecute,
  requiresExplicitPermission,
  type AbraAction,
} from "@/lib/ops/abra-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Match abra-actions.ts: default to true (enabled) unless explicitly disabled */
function isAutoExecutionEnabled(): boolean {
  const raw = String(process.env.ABRA_AUTO_EXEC_ENABLED || "").trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "off", "no"].includes(raw);
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

  let payload: ProposePayload = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const department =
    typeof payload.department === "string" && payload.department.trim()
      ? payload.department.trim()
      : "executive";
  const actionTypeRaw =
    typeof payload.action_type === "string" ? payload.action_type.trim() : "";
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const description =
    typeof payload.description === "string" ? payload.description.trim() : "";
  const params =
    payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)
      ? (payload.params as Record<string, unknown>)
      : {};
  const confidenceRaw = Number(payload.confidence ?? 0.8);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : 0.8;
  const autoExecuteRequested = payload.auto_execute === true;
  const requestedRisk = parseRisk(payload.risk_level);

  if (!actionTypeRaw) {
    return NextResponse.json({ error: "action_type is required" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!description) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

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
