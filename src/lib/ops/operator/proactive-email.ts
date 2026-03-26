import {
  ABRA_CONTROL_CHANNEL_ID,
  formatCurrency,
} from "@/lib/ops/operator/reports/shared";
import { readState, writeState } from "@/lib/ops/state";

type OperatorTaskRow = {
  id: string;
  task_type: string;
  title: string;
  created_at: string;
  due_by: string | null;
  execution_params: Record<string, unknown> | null;
  execution_result: Record<string, unknown> | null;
  status: string;
};

export type ProactiveEmailSurfaceResult = {
  surfaced: number;
};

type SurfacedEmailState = Record<string, string>;

const SURFACED_EMAILS_STATE_KEY = "abra:surfaced_emails" as never;
const SURFACED_TTL_MS = 48 * 60 * 60 * 1000;

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }
  return { baseUrl, serviceKey };
}

async function sbFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const env = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(15000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return json as T;
}

function getSlackToken(): string {
  return (process.env.SLACK_BOT_TOKEN || "").trim();
}

async function postSlackBlocks(channel: string, text: string, blocks: unknown[]): Promise<{ ok: boolean; ts?: string }> {
  const token = getSlackToken();
  if (!token) return { ok: false };
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text,
      blocks,
      mrkdwn: true,
      unfurl_links: false,
    }),
    signal: AbortSignal.timeout(12000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; ts?: string };
  return { ok: Boolean(json.ok), ts: json.ts };
}

function getApprovalId(task: OperatorTaskRow): string {
  return String(task.execution_result?.approval_id || task.execution_params?.approval_id || "").trim();
}

function getSurfacedAt(task: OperatorTaskRow): string {
  return String(task.execution_result?.surfaced_at || "").trim();
}

function getSurfaceKey(task: OperatorTaskRow): string {
  return String(
    task.execution_params?.message_id ||
    task.execution_params?.thread_id ||
    task.execution_params?.email_message_id ||
    task.id,
  ).trim();
}

function pruneSurfacedState(
  state: SurfacedEmailState,
  now = Date.now(),
): SurfacedEmailState {
  return Object.fromEntries(
    Object.entries(state).filter(([, surfacedAt]) => {
      const ts = new Date(surfacedAt).getTime();
      return Number.isFinite(ts) && now - ts < SURFACED_TTL_MS;
    }),
  );
}

function shouldSurface(task: OperatorTaskRow, surfacedState: SurfacedEmailState, now = Date.now()): boolean {
  if (!getApprovalId(task)) return false;
  const surfacedAt = getSurfacedAt(task);
  if (surfacedAt) return false;
  const surfaceKey = getSurfaceKey(task);
  const priorSurfacedAt = surfaceKey ? surfacedState[surfaceKey] : "";
  if (priorSurfacedAt) return false;
  if (!task.due_by) return true;
  const dueAt = new Date(task.due_by).getTime();
  return !Number.isFinite(dueAt) || dueAt <= now;
}

function hoursAgo(createdAt: string): number {
  const time = new Date(createdAt).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / (60 * 60 * 1000)));
}

function compactPreview(task: OperatorTaskRow): string {
  return String(
    task.execution_params?.body_preview ||
    task.execution_result?.body_preview ||
    task.execution_params?.description ||
    task.title,
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function buildCard(task: OperatorTaskRow): { text: string; blocks: unknown[] } {
  const sender = String(task.execution_params?.sender || task.execution_params?.vendor || task.execution_params?.distributor_name || "Unknown sender");
  const subject = String(task.execution_params?.subject || task.execution_params?.last_subject || "No subject");
  const preview = compactPreview(task);
  const ageHours = hoursAgo(task.created_at);
  const ageLabel = ageHours >= 24 ? `${Math.floor(ageHours / 24)} day${Math.floor(ageHours / 24) === 1 ? "" : "s"}` : `${ageHours} hour${ageHours === 1 ? "" : "s"}`;
  const amount = Number(task.execution_params?.amount || 0);
  const amountLine = amount > 0 ? `\n• Amount: ${formatCurrency(amount)}` : "";
  const text = `📧 ${sender} emailed ${ageLabel} ago re: ${subject}`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `📧 *${sender}* emailed ${ageLabel} ago re: *${subject}*\n` +
            `${preview}${amountLine}\n` +
            `Draft reply ready.`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View Draft" },
            style: "primary",
            action_id: "view_email_draft",
            value: task.id,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Skip" },
            action_id: "skip_email_task",
            value: task.id,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Remind Tomorrow" },
            action_id: "remind_email_task",
            value: task.id,
          },
        ],
      },
    ],
  };
}

async function markSurfaced(task: OperatorTaskRow, ts?: string): Promise<void> {
  const executionResult = {
    ...(task.execution_result || {}),
    surfaced_at: new Date().toISOString(),
    surfaced_slack_ts: ts || null,
  };
  await sbFetch(`/rest/v1/abra_operator_tasks?id=eq.${task.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      execution_result: executionResult,
    }),
  });
}

export async function surfaceProactiveEmailTasks(): Promise<ProactiveEmailSurfaceResult> {
  const surfacedState = pruneSurfacedState(
    await readState<SurfacedEmailState>(SURFACED_EMAILS_STATE_KEY, {}),
  );
  const rows = await sbFetch<OperatorTaskRow[]>(
    `/rest/v1/abra_operator_tasks?select=id,task_type,title,created_at,due_by,execution_params,execution_result,status&task_type=in.(email_draft_response,vendor_followup,distributor_followup)&status=in.(completed,needs_approval,pending)&order=created_at.asc&limit=50`,
  ).catch(() => []);

  const actionable = (Array.isArray(rows) ? rows : []).filter((task) => shouldSurface(task, surfacedState));
  let surfaced = 0;

  for (const task of actionable) {
    const card = buildCard(task);
    const result = await postSlackBlocks(ABRA_CONTROL_CHANNEL_ID, card.text, card.blocks);
    if (!result.ok) continue;
    surfaced += 1;
    const surfaceKey = getSurfaceKey(task);
    if (surfaceKey) {
      surfacedState[surfaceKey] = new Date().toISOString();
    }
    await markSurfaced(task, result.ts).catch(() => {});
  }

  await writeState(SURFACED_EMAILS_STATE_KEY, surfacedState).catch(() => {});

  return { surfaced };
}
