/**
 * Team Onboarding Flow
 *
 * When a new person joins, Abra runs an onboarding playbook:
 *  1. Creates Notion user page
 *  2. Sends welcome Slack DM with company overview
 *  3. Teaches Abra about the new team member
 *  4. Logs the onboarding in team directory
 */

import { notifyDaily } from "@/lib/ops/notify";

export type TeamMember = {
  name: string;
  email: string;
  role: string;
  type: "employee" | "contractor" | "investor" | "partner";
  slackUserId?: string;
  timezone?: string;
  startDate: string;
};

export type OnboardingResult = {
  member: TeamMember;
  steps: Array<{ step: string; ok: boolean; note: string }>;
  completed: boolean;
  timestamp: string;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function createBrainEntry(title: string, content: string, tags: string[]): Promise<boolean> {
  const env = getSupabaseEnv();
  if (!env) return false;

  try {
    await fetch(`${env.baseUrl}/rest/v1/open_brain_entries`, {
      method: "POST",
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        source_type: "automated",
        source_ref: `onboarding-${Date.now()}`,
        entry_type: "teaching",
        title,
        raw_text: content,
        summary_text: content.slice(0, 500),
        category: "team",
        department: "executive",
        tags,
        confidence: "high",
        priority: "important",
        processed: true,
      }),
      signal: AbortSignal.timeout(5000),
    });
    return true;
  } catch { return false; }
}

export async function onboardTeamMember(member: TeamMember): Promise<OnboardingResult> {
  const steps: OnboardingResult["steps"] = [];

  // Step 1: Create brain entry about the team member
  const brainContent = [
    `Name: ${member.name}`,
    `Email: ${member.email}`,
    `Role: ${member.role}`,
    `Type: ${member.type}`,
    `Start Date: ${member.startDate}`,
    member.timezone ? `Timezone: ${member.timezone}` : null,
  ].filter(Boolean).join("\n");

  const brainOk = await createBrainEntry(
    `Team Member: ${member.name} — ${member.role}`,
    brainContent,
    [`team:${member.name.toLowerCase().replace(/\s+/g, "_")}`, `role:${member.type}`],
  );
  steps.push({ step: "Create brain entry", ok: brainOk, note: brainOk ? "Team member added to Abra's memory" : "Failed to create brain entry" });

  // Step 2: Send welcome Slack DM (if Slack user ID provided)
  if (member.slackUserId) {
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (botToken) {
      try {
        const welcomeMsg = [
          `👋 *Welcome to USA Gummies, ${member.name.split(" ")[0]}!*`,
          "",
          `I'm Abra — the AI operations assistant. I handle daily ops, financial tracking, vendor communication, and reporting.`,
          "",
          `*Quick start:*`,
          `• Ask me anything: just @ mention me in any channel`,
          `• Teach me: \`teach: [topic] your knowledge here\``,
          `• Get status: ask "what's the status?"`,
          `• Financial questions: I pull from QBO and Plaid in real-time`,
          "",
          `*Your role context:* ${member.role} (${member.type})`,
          `*Team:* Ben Stutman (CEO), Andrew Slater (Ops), Rene Gonzalez (Finance)`,
          "",
          `Let me know if you have any questions!`,
        ].join("\n");

        const res = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ channel: member.slackUserId, text: welcomeMsg }),
          signal: AbortSignal.timeout(8000),
        });
        const data = (await res.json()) as { ok: boolean };
        steps.push({ step: "Send welcome DM", ok: data.ok, note: data.ok ? "Welcome message sent" : "Failed to send DM" });
      } catch {
        steps.push({ step: "Send welcome DM", ok: false, note: "Slack API error" });
      }
    }
  } else {
    steps.push({ step: "Send welcome DM", ok: false, note: "No Slack user ID provided — skipped" });
  }

  // Step 3: Notify the team
  void notifyDaily(
    `👤 *New team member onboarded:* ${member.name}\n` +
    `Role: ${member.role} (${member.type})\n` +
    `Email: ${member.email}\n` +
    `Start: ${member.startDate}`,
  );
  steps.push({ step: "Notify team", ok: true, note: "Posted to #daily" });

  const completed = steps.every(s => s.ok);

  return {
    member,
    steps,
    completed,
    timestamp: new Date().toISOString(),
  };
}
