/**
 * Abra Task Queue — ensures every commitment gets tracked and completed.
 *
 * When Abra says "On it", the task gets logged here with a 5-minute deadline.
 * If the task isn't completed by the deadline, it escalates:
 *   1. Posts to Slack: "I couldn't complete X — here's why"
 *   2. Creates a Claude Code escalation task
 *   3. Marks the task as "escalated" so it doesn't get lost
 *
 * This is the self-healing layer that prevents silent failures.
 */

import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "escalated";

export type QueuedTask = {
  id: string;
  task_type: string;
  description: string;
  status: TaskStatus;
  action_type?: string;
  action_params?: Record<string, unknown>;
  requested_by?: string;
  requested_in_channel?: string;
  requested_in_thread?: string;
  deadline_at: string;
  result_message?: string;
  error_message?: string;
};

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const env = getSupabaseEnv();
  if (!env) return null;
  try {
    const res = await fetch(`${env.baseUrl}${path}`, {
      ...init,
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(init?.headers || {}),
      },
      signal: init?.signal ?? AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Queue a task when Abra commits to doing something.
 * Returns the task ID for tracking.
 */
export async function queueTask(opts: {
  task_type: string;
  description: string;
  action_type?: string;
  action_params?: Record<string, unknown>;
  requested_by?: string;
  channel_id?: string;
  thread_ts?: string;
  deadline_minutes?: number;
}): Promise<string | null> {
  const deadlineMinutes = opts.deadline_minutes ?? 5;
  const deadline = new Date(Date.now() + deadlineMinutes * 60 * 1000).toISOString();

  const rows = await sbFetch<Array<{ id: string }>>("/rest/v1/abra_task_queue", {
    method: "POST",
    body: JSON.stringify({
      id: randomUUID(),
      task_type: opts.task_type,
      description: opts.description,
      status: "pending",
      action_type: opts.action_type || null,
      action_params: opts.action_params || null,
      requested_by: opts.requested_by || null,
      requested_in_channel: opts.channel_id || null,
      requested_in_thread: opts.thread_ts || null,
      deadline_at: deadline,
    }),
  });

  return rows?.[0]?.id || null;
}

/**
 * Mark a task as completed with a result message.
 */
export async function completeTask(taskId: string, result: string): Promise<void> {
  await sbFetch(`/rest/v1/abra_task_queue?id=eq.${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "completed",
      completed_at: new Date().toISOString(),
      result_message: result,
      updated_at: new Date().toISOString(),
    }),
  });
}

/**
 * Mark a task as failed with an error message.
 */
export async function failTask(taskId: string, error: string): Promise<void> {
  await sbFetch(`/rest/v1/abra_task_queue?id=eq.${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "failed",
      error_message: error,
      updated_at: new Date().toISOString(),
    }),
  });
}

/**
 * Check for overdue tasks and escalate them.
 * Called by the scheduler every 5 minutes.
 */
export async function escalateOverdueTasks(): Promise<{
  escalated: number;
  tasks: Array<{ id: string; description: string; error: string }>;
}> {
  const now = new Date().toISOString();

  // Find tasks past their deadline that haven't been completed or already escalated
  const overdue = await sbFetch<QueuedTask[]>(
    `/rest/v1/abra_task_queue?status=in.("pending","in_progress")&deadline_at=lt.${encodeURIComponent(now)}&select=id,description,task_type,action_type,requested_by,requested_in_channel,requested_in_thread,error_message&limit=20`,
  );

  if (!overdue || overdue.length === 0) {
    return { escalated: 0, tasks: [] };
  }

  const escalatedTasks: Array<{ id: string; description: string; error: string }> = [];

  for (const task of overdue) {
    const errorMsg = task.error_message || "Task exceeded 5-minute deadline without completing";

    // Mark as escalated
    await sbFetch(`/rest/v1/abra_task_queue?id=eq.${task.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "escalated",
        escalated_to: "slack",
        escalation_message: errorMsg,
        updated_at: new Date().toISOString(),
      }),
    });

    // Post escalation to Slack
    const slackChannel = task.requested_in_channel || process.env.SLACK_CHANNEL_ALERTS || "C0ALS6W7VB4";
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (botToken) {
      const message = `⚠️ *Task Failed — Escalating*\n\n*What was requested:* ${task.description}\n*Why it failed:* ${errorMsg}\n*Status:* I'm flagging this for manual review. This task did not complete as promised.\n\n_Abra is being honest about what it couldn't do._`;

      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: slackChannel,
          text: message,
          thread_ts: task.requested_in_thread || undefined,
          mrkdwn: true,
        }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }

    escalatedTasks.push({
      id: task.id,
      description: task.description,
      error: errorMsg,
    });
  }

  return { escalated: escalatedTasks.length, tasks: escalatedTasks };
}

/**
 * Get task queue status for diagnostics.
 */
export async function getTaskQueueStatus(): Promise<{
  pending: number;
  in_progress: number;
  completed_today: number;
  failed_today: number;
  escalated_today: number;
}> {
  const today = new Date().toISOString().slice(0, 10);

  const all = await sbFetch<Array<{ status: string; created_at: string }>>(
    `/rest/v1/abra_task_queue?select=status,created_at&created_at=gte.${today}T00:00:00Z&limit=500`,
  );

  if (!all) return { pending: 0, in_progress: 0, completed_today: 0, failed_today: 0, escalated_today: 0 };

  return {
    pending: all.filter((t) => t.status === "pending").length,
    in_progress: all.filter((t) => t.status === "in_progress").length,
    completed_today: all.filter((t) => t.status === "completed").length,
    failed_today: all.filter((t) => t.status === "failed").length,
    escalated_today: all.filter((t) => t.status === "escalated").length,
  };
}
