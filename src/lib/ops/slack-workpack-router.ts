import type { WorkpackInput, WorkpackRecord } from "./workpacks";

export type SlackWorkpackCommand =
  | "ask_codex"
  | "ask_claude"
  | "draft_reply"
  | "summarize_thread"
  | "turn_into_task";

export interface ParsedSlackWorkpackCommand {
  command: SlackWorkpackCommand;
  prompt: string;
  workpack: WorkpackInput;
}

const COMMANDS: Array<{
  command: SlackWorkpackCommand;
  pattern: RegExp;
  title: string;
  intent: WorkpackInput["intent"];
  department?: WorkpackInput["department"];
  allowedActions: string[];
}> = [
  {
    command: "ask_codex",
    pattern: /^\s*ask\s+codex\b[:\s-]*(.+)$/is,
    title: "Codex implementation prompt",
    intent: "prepare_codex_prompt",
    department: "ops",
    allowedActions: ["prepare_prompt", "draft_only"],
  },
  {
    command: "ask_claude",
    pattern: /^\s*ask\s+claude\b[:\s-]*(.+)$/is,
    title: "Claude Code implementation prompt",
    intent: "prepare_codex_prompt",
    department: "ops",
    allowedActions: ["prepare_prompt", "draft_only"],
  },
  {
    command: "draft_reply",
    pattern: /^\s*draft\s+(?:a\s+)?reply\b[:\s-]*(.+)$/is,
    title: "Draft Slack/email reply",
    intent: "draft_reply",
    department: "email",
    allowedActions: ["draft_only", "request_approval"],
  },
  {
    command: "summarize_thread",
    pattern: /^\s*summarize(?:\s+this|\s+thread)?\b[:\s-]*(.*)$/is,
    title: "Summarize Slack thread",
    intent: "summarize_thread",
    department: "general",
    allowedActions: ["summary_only"],
  },
  {
    command: "turn_into_task",
    pattern: /^\s*turn\s+(?:this\s+)?into\s+(?:a\s+)?task\b[:\s-]*(.*)$/is,
    title: "Turn Slack thread into task",
    intent: "summarize_thread",
    department: "ops",
    allowedActions: ["task_draft_only"],
  },
];

function cleanPrompt(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function slackMessageUrl(channel: string, ts: string): string {
  return `https://usagummies.slack.com/archives/${encodeURIComponent(channel)}/p${ts.replace(".", "")}`;
}

export function parseSlackWorkpackCommand(input: {
  text: string;
  channel?: string;
  ts?: string;
  threadTs?: string;
  user?: string;
}): ParsedSlackWorkpackCommand | null {
  const text = input.text.trim();
  if (!text) return null;
  for (const spec of COMMANDS) {
    const match = spec.pattern.exec(text);
    if (!match) continue;
    const prompt = cleanPrompt(match[1] ?? "");
    const sourceUrl =
      input.channel && (input.threadTs || input.ts)
        ? slackMessageUrl(input.channel, input.threadTs ?? input.ts ?? "")
        : undefined;
    return {
      command: spec.command,
      prompt,
      workpack: {
        intent: spec.intent,
        department: spec.department,
        title: spec.title,
        sourceText: prompt || text,
        sourceUrl,
        requestedBy: input.user,
        allowedActions: spec.allowedActions,
        riskClass: "read_only",
      },
    };
  }
  return null;
}

export function renderWorkpackCreatedSlackCard(
  record: WorkpackRecord,
): { text: string; blocks: unknown[] } {
  const text = `Workpack queued — ${record.title}`;
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Workpack queued", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Intent*\n${record.intent}` },
        { type: "mrkdwn", text: `*Department*\n${record.department}` },
        { type: "mrkdwn", text: `*Status*\n${record.status}` },
        { type: "mrkdwn", text: `*Risk*\n${record.riskClass}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${record.title}*\n${record.sourceText.slice(0, 900)}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `ID \`${record.id}\` · no email/send/CRM/checkout/QBO action can execute from this workpack without a later approval route.`,
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open workpacks", emoji: true },
          url: "https://www.usagummies.com/api/ops/workpacks",
          action_id: "open_workpacks",
        },
        ...(record.sourceUrl
          ? [
              {
                type: "button",
                text: { type: "plain_text", text: "Source thread", emoji: true },
                url: record.sourceUrl,
                action_id: "open_source_thread",
              },
            ]
          : []),
      ],
    },
  ];
  return { text, blocks };
}
