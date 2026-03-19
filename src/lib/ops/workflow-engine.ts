import { proposeAction, executeActionByType, requiresExplicitPermission, type AbraAction, type ActionResult } from "@/lib/ops/abra-actions";
import { WORKFLOWS } from "@/lib/ops/workflows";

export type WorkflowDefinition = {
  id: string;
  name: string;
  description: string;
  trigger: "manual" | "event" | "schedule";
  steps: WorkflowStep[];
};

export type InputMapper = {
  [key: string]: unknown;
};

export type WorkflowStep = {
  id: string;
  name: string;
  action_type: string;
  input: Record<string, unknown> | InputMapper;
  condition?: string;
  on_failure: "retry" | "skip" | "abort" | "human_review";
  max_retries?: number;
  requires_approval?: boolean;
  timeout_ms?: number;
};

export type WorkflowRunStepResult = {
  step_id: string;
  status: "completed" | "failed" | "skipped" | "pending_approval";
  result?: unknown;
  error?: string;
  started_at: string;
  completed_at?: string;
};

export type WorkflowRun = {
  id: string;
  workflow_id: string;
  status: "running" | "paused" | "completed" | "failed" | "cancelled";
  current_step_index: number;
  context: Record<string, unknown>;
  step_results: WorkflowRunStepResult[];
  started_at: string;
  completed_at?: string;
  started_by: string;
  error?: string | null;
};

type WorkflowMeta = {
  approvedSteps?: Record<string, boolean>;
  pendingApprovalId?: string;
  pendingStepId?: string;
};

const DEFAULT_TIMEOUT_MS = 30_000;

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Supabase not configured");
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 300)}`,
    );
  }

  return json;
}

function workflowMeta(context: Record<string, unknown>): WorkflowMeta {
  const meta =
    context._workflow && typeof context._workflow === "object"
      ? (context._workflow as WorkflowMeta)
      : {};
  return {
    approvedSteps:
      meta.approvedSteps && typeof meta.approvedSteps === "object"
        ? meta.approvedSteps
        : {},
    pendingApprovalId:
      typeof meta.pendingApprovalId === "string" ? meta.pendingApprovalId : undefined,
    pendingStepId:
      typeof meta.pendingStepId === "string" ? meta.pendingStepId : undefined,
  };
}

function withWorkflowMeta(
  context: Record<string, unknown>,
  patch: WorkflowMeta,
): Record<string, unknown> {
  const current = workflowMeta(context);
  return {
    ...context,
    _workflow: {
      approvedSteps: {
        ...(current.approvedSteps || {}),
        ...(patch.approvedSteps || {}),
      },
      ...(patch.pendingApprovalId !== undefined
        ? { pendingApprovalId: patch.pendingApprovalId || null }
        : current.pendingApprovalId
          ? { pendingApprovalId: current.pendingApprovalId }
          : {}),
      ...(patch.pendingStepId !== undefined
        ? { pendingStepId: patch.pendingStepId || null }
        : current.pendingStepId
          ? { pendingStepId: current.pendingStepId }
          : {}),
    },
  };
}

function getPathValue(root: unknown, path: string): unknown {
  const clean = path.replace(/^\$/, "").replace(/^\./, "");
  if (!clean) return root;
  return clean.split(".").reduce<unknown>((value, segment) => {
    if (!segment) return value;
    if (Array.isArray(value) && /^\d+$/.test(segment)) {
      return value[Number(segment)];
    }
    if (value && typeof value === "object") {
      return (value as Record<string, unknown>)[segment];
    }
    return undefined;
  }, root);
}

function renderTemplate(template: string, root: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, path: string) => {
    const value = getPathValue(root, path.trim());
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  });
}

export function resolveInputs(
  inputDef: Record<string, unknown> | InputMapper,
  context: Record<string, unknown>,
): Record<string, unknown> {
  const root = {
    context,
    steps:
      context.steps && typeof context.steps === "object"
        ? context.steps
        : {},
  };

  const resolveValue = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (value.startsWith("$")) return getPathValue(root, value);
      if (value.includes("{{")) return renderTemplate(value, root);
      return value;
    }
    if (Array.isArray(value)) return value.map((item) => resolveValue(item));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, child]) => [
          key,
          resolveValue(child),
        ]),
      );
    }
    return value;
  };

  return resolveValue(inputDef) as Record<string, unknown>;
}

function evaluateCondition(condition: string | undefined, context: Record<string, unknown>): boolean {
  if (!condition?.trim()) return true;
  try {
    const fn = new Function(
      "context",
      "steps",
      `return Boolean(${condition});`,
    );
    const steps =
      context.steps && typeof context.steps === "object"
        ? context.steps
        : {};
    return Boolean(fn(context, steps));
  } catch {
    return false;
  }
}

async function fetchApprovalStatus(approvalId: string): Promise<string | null> {
  const rows = (await sbFetch(
    `/rest/v1/approvals?id=eq.${encodeURIComponent(approvalId)}&select=id,status&limit=1`,
  )) as Array<{ id: string; status?: string | null }>;
  return rows[0]?.status || null;
}

async function fetchWorkflowRunRaw(runId: string): Promise<WorkflowRun | null> {
  const rows = (await sbFetch(
    `/rest/v1/workflow_runs?id=eq.${encodeURIComponent(runId)}&select=id,workflow_id,status,current_step_index,context,step_results,started_at,completed_at,started_by,error&limit=1`,
  )) as WorkflowRun[];
  return rows[0] || null;
}

async function updateWorkflowRun(
  runId: string,
  patch: Partial<WorkflowRun>,
): Promise<WorkflowRun> {
  const rows = (await sbFetch(
    `/rest/v1/workflow_runs?id=eq.${encodeURIComponent(runId)}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
    },
  )) as WorkflowRun[];
  if (!rows[0]) throw new Error("Failed to update workflow run");
  return rows[0];
}

function setStepResult(
  stepResults: WorkflowRunStepResult[],
  result: WorkflowRunStepResult,
): WorkflowRunStepResult[] {
  const next = [...stepResults];
  const idx = next.findIndex((item) => item.step_id === result.step_id);
  if (idx >= 0) next[idx] = result;
  else next.push(result);
  return next;
}

async function pauseForApproval(
  run: WorkflowRun,
  definition: WorkflowDefinition,
  step: WorkflowStep,
  reason: string,
): Promise<WorkflowRun> {
  const approvalAction: AbraAction = {
    action_type: "resume_workflow",
    title: `Resume workflow ${definition.name}`,
    description: `${definition.name} paused at "${step.name}". ${reason}`,
    department: "executive",
    risk_level: "medium",
    params: {
      run_id: run.id,
      decision: "approved",
      step_id: step.id,
      workflow_id: definition.id,
      step_name: step.name,
    },
    requires_approval: true,
    confidence: 0.95,
  };
  const approvalStatus = await proposeAction(approvalAction);
  const approvalId = approvalStatus.replace(/^queued:/, "");

  return updateWorkflowRun(run.id, {
    status: "paused",
    context: withWorkflowMeta(run.context, {
      pendingApprovalId: approvalId,
      pendingStepId: step.id,
    }),
    step_results: setStepResult(run.step_results, {
      step_id: step.id,
      status: "pending_approval",
      started_at: new Date().toISOString(),
      result: {
        approval_id: approvalId,
        reason,
      },
    }),
  });
}

function normalizeActionResult(result: ActionResult): { success: boolean; result?: unknown; error?: string } {
  if (result.success) {
    return {
      success: true,
      result: result.data || { message: result.message },
    };
  }
  return {
    success: false,
    error: result.message,
  };
}

async function executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Step timed out after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function executeStep(
  run: WorkflowRun,
  step: WorkflowStep,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const resolvedInputs = resolveInputs(step.input || {}, run.context);
  try {
    const result = await executeWithTimeout(
      executeActionByType(step.action_type, resolvedInputs),
      step.timeout_ms || DEFAULT_TIMEOUT_MS,
    );
    return normalizeActionResult(result);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Step execution failed",
    };
  }
}

async function runWorkflowLoop(run: WorkflowRun): Promise<WorkflowRun> {
  const definition = WORKFLOWS[run.workflow_id];
  if (!definition) {
    return updateWorkflowRun(run.id, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error: `Unknown workflow ${run.workflow_id}`,
    });
  }

  let current = run;
  while (current.current_step_index < definition.steps.length) {
    const step = definition.steps[current.current_step_index];
    const now = new Date().toISOString();

    if (!evaluateCondition(step.condition, current.context)) {
      current = await updateWorkflowRun(current.id, {
        current_step_index: current.current_step_index + 1,
        step_results: setStepResult(current.step_results, {
          step_id: step.id,
          status: "skipped",
          started_at: now,
          completed_at: now,
          result: { reason: "condition_false" },
        }),
      });
      continue;
    }

    const meta = workflowMeta(current.context);
    const shouldPause =
      !meta.approvedSteps?.[step.id] &&
      (step.requires_approval || requiresExplicitPermission(step.action_type));
    if (shouldPause) {
      return pauseForApproval(current, definition, step, "Approval required before external or gated step execution.");
    }

    let attempts = 0;
    const maxAttempts = Math.max(1, (step.max_retries || 2) + 1);
    let outcome: { success: boolean; result?: unknown; error?: string } = {
      success: false,
      error: "Unknown workflow step error",
    };

    while (attempts < maxAttempts) {
      attempts += 1;
      outcome = await executeStep(current, step);
      if (outcome.success) break;
      if (step.on_failure !== "retry" || attempts >= maxAttempts) break;
    }

    if (outcome.success) {
      const nextContext = withWorkflowMeta(
        {
          ...current.context,
          steps: {
            ...(current.context.steps && typeof current.context.steps === "object"
              ? (current.context.steps as Record<string, unknown>)
              : {}),
            [step.id]: {
              status: "completed",
              result: outcome.result,
            },
          },
        },
        {
          approvedSteps: {
            ...(workflowMeta(current.context).approvedSteps || {}),
            [step.id]: false,
          },
          pendingApprovalId: "",
          pendingStepId: "",
        },
      );

      current = await updateWorkflowRun(current.id, {
        current_step_index: current.current_step_index + 1,
        context: nextContext,
        step_results: setStepResult(current.step_results, {
          step_id: step.id,
          status: "completed",
          started_at: now,
          completed_at: new Date().toISOString(),
          result: outcome.result,
        }),
      });
      continue;
    }

    if (step.on_failure === "skip") {
      current = await updateWorkflowRun(current.id, {
        current_step_index: current.current_step_index + 1,
        step_results: setStepResult(current.step_results, {
          step_id: step.id,
          status: "skipped",
          started_at: now,
          completed_at: new Date().toISOString(),
          error: outcome.error,
        }),
      });
      continue;
    }

    if (step.on_failure === "human_review") {
      return pauseForApproval(current, definition, step, outcome.error || "Step requires human review");
    }

    current = await updateWorkflowRun(current.id, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error: outcome.error || `Workflow failed at ${step.id}`,
      step_results: setStepResult(current.step_results, {
        step_id: step.id,
        status: "failed",
        started_at: now,
        completed_at: new Date().toISOString(),
        error: outcome.error,
      }),
    });
    return current;
  }

  return updateWorkflowRun(current.id, {
    status: "completed",
    completed_at: new Date().toISOString(),
    context: withWorkflowMeta(current.context, {
      pendingApprovalId: "",
      pendingStepId: "",
    }),
  });
}

export async function startWorkflow(
  workflowId: string,
  initialContext: Record<string, unknown>,
  startedBy: string,
): Promise<WorkflowRun> {
  const definition = WORKFLOWS[workflowId];
  if (!definition) throw new Error(`Unknown workflow "${workflowId}"`);

  const created = (await sbFetch("/rest/v1/workflow_runs", {
    method: "POST",
    headers: {
      Prefer: "return=representation",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      workflow_id: workflowId,
      status: "running",
      current_step_index: 0,
      context: withWorkflowMeta(initialContext || {}, {
        approvedSteps: {},
        pendingApprovalId: "",
        pendingStepId: "",
      }),
      step_results: [],
      started_by: startedBy,
      started_at: new Date().toISOString(),
    }),
  })) as WorkflowRun[];

  if (!created[0]) throw new Error("Failed to create workflow run");
  return runWorkflowLoop(created[0]);
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRun | null> {
  const run = await fetchWorkflowRunRaw(runId);
  if (!run) return null;

  const meta = workflowMeta(run.context);
  if (run.status === "paused" && meta.pendingApprovalId) {
    const approvalStatus = await fetchApprovalStatus(meta.pendingApprovalId);
    if (approvalStatus === "denied") {
      return updateWorkflowRun(run.id, {
        status: "cancelled",
        completed_at: new Date().toISOString(),
        error: `Approval denied for ${meta.pendingStepId || "workflow step"}`,
      });
    }
  }

  return run;
}

export async function resumeWorkflow(
  runId: string,
  approvalDecision?: "approved" | "denied",
): Promise<WorkflowRun> {
  const run = await getWorkflowRun(runId);
  if (!run) throw new Error("Workflow run not found");
  if (run.status === "completed" || run.status === "cancelled" || run.status === "failed") {
    return run;
  }

  const definition = WORKFLOWS[run.workflow_id];
  if (!definition) throw new Error(`Unknown workflow "${run.workflow_id}"`);
  const step = definition.steps[run.current_step_index];
  if (!step) throw new Error("Workflow has no current step");

  if (approvalDecision === "denied") {
    return updateWorkflowRun(run.id, {
      status: "cancelled",
      completed_at: new Date().toISOString(),
      error: `Approval denied for step ${step.name}`,
      context: withWorkflowMeta(run.context, {
        pendingApprovalId: "",
        pendingStepId: "",
      }),
      step_results: setStepResult(run.step_results, {
        step_id: step.id,
        status: "failed",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        error: "Approval denied",
      }),
    });
  }

  const resumed = await updateWorkflowRun(run.id, {
    status: "running",
    context: withWorkflowMeta(run.context, {
      approvedSteps: {
        ...(workflowMeta(run.context).approvedSteps || {}),
        [step.id]: true,
      },
      pendingApprovalId: "",
      pendingStepId: "",
    }),
  });
  return runWorkflowLoop(resumed);
}

export async function cancelWorkflow(runId: string): Promise<void> {
  await updateWorkflowRun(runId, {
    status: "cancelled",
    completed_at: new Date().toISOString(),
    error: "Cancelled by operator",
  });
}
