/**
 * Email-to-Action Pipeline
 *
 * When an email arrives from a known vendor/prospect, extracts action items
 * and auto-creates tasks. "Can you confirm the label specs by Friday" →
 * Task: "Confirm label specs with Powers" due Friday.
 */

import { proposeAndMaybeExecute } from "@/lib/ops/abra-actions";

type ExtractedAction = {
  task: string;
  assignee: string;
  dueDate: string | null;
  source: string;
  urgency: "high" | "normal" | "low";
};

// Action-triggering patterns in email content
const ACTION_PATTERNS: Array<{ pattern: RegExp; urgency: "high" | "normal" | "low" }> = [
  { pattern: /(?:can you|could you|please)\s+(?:confirm|send|provide|review|check|update|approve)\s+(.{10,80}?)(?:\?|by|before|\.|$)/i, urgency: "normal" },
  { pattern: /(?:need|require|must have)\s+(?:a |the )?(.{10,80}?)(?:by|before|asap|\.|$)/i, urgency: "high" },
  { pattern: /(?:by|before|due|deadline)\s+((?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|end of (?:day|week)|next week|\d{1,2}\/\d{1,2}|march|april|may)\b.*?)(?:\.|,|$)/i, urgency: "normal" },
  { pattern: /(?:action\s*(?:item|needed|required)|follow.up|next\s*step)[\s:]+(.{10,100}?)(?:\.|$)/i, urgency: "normal" },
  { pattern: /(?:urgent|asap|immediately|critical|time.sensitive)\s*[:=-]?\s*(.{10,80})/i, urgency: "high" },
];

// Date extraction
function extractDueDate(text: string): string | null {
  const now = new Date();
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  if (/tomorrow/i.test(text)) {
    const d = new Date(now); d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (/end of (?:this )?week/i.test(text)) {
    const d = new Date(now); d.setDate(d.getDate() + (5 - d.getDay()));
    return d.toISOString().slice(0, 10);
  }
  if (/next week/i.test(text)) {
    const d = new Date(now); d.setDate(d.getDate() + (8 - d.getDay()));
    return d.toISOString().slice(0, 10);
  }

  for (let i = 0; i < dayNames.length; i++) {
    if (text.toLowerCase().includes(dayNames[i])) {
      const d = new Date(now);
      const daysUntil = (i - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + daysUntil);
      return d.toISOString().slice(0, 10);
    }
  }

  return null;
}

export function extractActionsFromEmail(
  emailBody: string,
  fromName: string,
  subject: string,
): ExtractedAction[] {
  const actions: ExtractedAction[] = [];

  for (const { pattern, urgency } of ACTION_PATTERNS) {
    const match = emailBody.match(pattern);
    if (match && match[1]) {
      const task = match[1].trim().replace(/\s+/g, " ");
      if (task.length < 10 || task.length > 200) continue;

      const dueDate = extractDueDate(emailBody);
      actions.push({
        task: `${task} (from ${fromName})`,
        assignee: "Ben Stutman",
        dueDate,
        source: `Email: "${subject}" from ${fromName}`,
        urgency,
      });
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return actions.filter(a => {
    const key = a.task.toLowerCase().slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3); // Max 3 actions per email
}

export async function processEmailActions(
  emailBody: string,
  fromName: string,
  subject: string,
): Promise<{ extracted: number; created: number }> {
  const actions = extractActionsFromEmail(emailBody, fromName, subject);
  let created = 0;

  for (const action of actions) {
    try {
      await proposeAndMaybeExecute({
        action_type: "create_task",
        title: `Email Action: ${action.task.slice(0, 60)}`,
        description: `Auto-extracted from email. ${action.source}`,
        department: "operations",
        risk_level: "low",
        requires_approval: false,
        confidence: 0.75,
        params: {
          title: action.task,
          description: `${action.source}\nUrgency: ${action.urgency}${action.dueDate ? `\nDue: ${action.dueDate}` : ""}`,
          priority: action.urgency === "high" ? "high" : "normal",
        },
      });
      created++;
    } catch { /* non-fatal */ }
  }

  return { extracted: actions.length, created };
}
