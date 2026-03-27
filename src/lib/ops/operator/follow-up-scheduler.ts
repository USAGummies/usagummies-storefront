import { getEntityStates, type EntityState } from "@/lib/ops/operator/entities/entity-state";

type OperatorTaskInsert = {
  task_type: string;
  title: string;
  description?: string;
  priority?: "critical" | "high" | "medium" | "low";
  source?: string;
  assigned_to?: string;
  requires_approval?: boolean;
  execution_params?: Record<string, unknown>;
  due_by?: string;
  tags?: string[];
};

export type FollowUpSchedulerResult = {
  tasks: OperatorTaskInsert[];
  summary: {
    dueCount: number;
    due: Array<{ entity: string; daysSince: number }>;
  };
};

const ENTITY_EMAILS: Record<string, string> = {
  "Powers Confections": "gregk@powers-inc.com",
  "Albanese Confectionery": "bill@albaneseconfectionery.com",
  Belmark: "jonathan@belmark.com",
  "Inderbitzin Distributors": "patrick@inderbitzin.com",
  "Reid Mitchell": "reid@reidmitchell.com",
  "Mike Arlint": "mike@arlint.com",
};

function buildNaturalKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

function daysSince(dateIso: string | null): number {
  if (!dateIso) return 999;
  const ts = Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(ts)) return 999;
  return Math.max(0, Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000)));
}

function followUpRule(state: EntityState): { dueAfter: number; priority: "high" | "medium"; taskType: "vendor_followup" | "distributor_followup" } | null {
  if (state.type === "vendor" && /powers|albanese|belmark/i.test(state.name)) {
    return { dueAfter: 5, priority: "high", taskType: "vendor_followup" };
  }
  if (state.type === "customer" && /inderbitzin/i.test(state.name)) {
    return { dueAfter: 3, priority: "high", taskType: "distributor_followup" };
  }
  if (state.type === "broker" && /reid/i.test(state.name)) {
    return { dueAfter: 7, priority: "medium", taskType: "vendor_followup" };
  }
  if (state.type === "customer" && /mike arlint/i.test(state.name)) {
    return { dueAfter: 2, priority: "high", taskType: "distributor_followup" };
  }
  return null;
}

function suggestedMessage(state: EntityState): string {
  const summary = state.last_contact_summary || "recent conversation";
  return `Following up on ${summary}. Next step is to keep the thread moving and close the open item.`;
}

export async function detectScheduledFollowUps(): Promise<FollowUpSchedulerResult> {
  const states = await getEntityStates();
  const tasks: OperatorTaskInsert[] = [];
  const due: Array<{ entity: string; daysSince: number }> = [];
  for (const state of states) {
    const rule = followUpRule(state);
    if (!rule) continue;
    const silentDays = daysSince(state.last_contact_date);
    if (silentDays <= rule.dueAfter) continue;
    due.push({ entity: state.name, daysSince: silentDays });
    tasks.push({
      task_type: rule.taskType,
      title: `Follow up with ${state.name} — last contact ${silentDays}d ago`,
      description: state.last_contact_summary || `Follow-up due for ${state.name}`,
      priority: rule.priority,
      source: "gap_detector:follow_up_scheduler",
      assigned_to: "abra",
      requires_approval: true,
      execution_params: {
        natural_key: buildNaturalKey(["followup", state.name, state.last_contact_date]),
        vendor: state.name,
        distributor_name: state.name,
        contact_email: ENTITY_EMAILS[state.name] || "",
        email: ENTITY_EMAILS[state.name] || "",
        last_subject: state.last_contact_summary || `Follow-up with ${state.name}`,
        body_preview: suggestedMessage(state),
      },
      tags: ["follow-up", state.type],
    });
  }
  return {
    tasks,
    summary: {
      dueCount: due.length,
      due: due.slice(0, 6),
    },
  };
}
