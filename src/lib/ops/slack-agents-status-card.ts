/**
 * Slack Block Kit renderer for the `agents status` command.
 *
 * Build 6 finish per blueprint §4 — surfaces the active workpack
 * prompt packs (per-department) so an operator can confirm what
 * external AI tools are configured to do in each lane.
 *
 * Pure module — takes the prompt-pack registry + global prohibited
 * list and renders a compact Block Kit card:
 *   1. Header
 *   2. One section per pack (department · role · readTools count ·
 *      prohibitedActions count · approvalSlugs)
 *   3. Global prohibited list collapsed into a context block
 *   4. "Open registry" action button → /api/ops/openai-workspace-tools/workpack-prompts
 */
import type { WorkpackPromptPack } from "./workpack-prompts";

const REGISTRY_URL =
  "https://www.usagummies.com/api/ops/openai-workspace-tools/workpack-prompts";

export interface AgentsStatusCard {
  text: string;
  blocks: unknown[];
}

export function renderAgentsStatusCard(args: {
  packs: ReadonlyArray<WorkpackPromptPack>;
  prohibitedGlobal: ReadonlyArray<string>;
  generatedAt?: string;
}): AgentsStatusCard {
  const { packs, prohibitedGlobal } = args;
  const generatedAt = args.generatedAt ?? new Date().toISOString();

  const text =
    packs.length === 0
      ? "🧠 Agents status — no workpack prompt packs registered"
      : `🧠 Agents status — ${packs.length} prompt pack${packs.length === 1 ? "" : "s"} registered`;

  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🧠 Agents status — ${packs.length} pack${packs.length === 1 ? "" : "s"}`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*External AI tools (ChatGPT workspace, Claude Code, Codex) read these packs to know what they're allowed to do in each lane. Read-only — every mutation still routes through the canonical Class B/C approval flow.*",
      },
    },
  ];

  for (const pack of packs) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*${labelForDepartment(pack.department)}*\n` +
          `${truncate(pack.role, 220)}\n\n` +
          `_Read tools_: ${pack.readTools.length} · _Prohibited actions_: ${pack.prohibitedActions.length} · _Approval slugs_: ${pack.approvalSlugs.length}\n` +
          `_Handoff_: \`${pack.humanHandoff.slug}\``,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `*Global prohibitions* (apply to every pack): ${prohibitedGlobal.length} rules locked. See registry for details.`,
      },
      {
        type: "mrkdwn",
        text: `Generated ${formatShortTime(generatedAt)} · Read-only — no execution fires from this card`,
      },
    ],
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Open prompt-pack registry",
          emoji: true,
        },
        url: REGISTRY_URL,
        action_id: "open_workpack_prompts",
      },
    ],
  });

  return { text, blocks };
}

function labelForDepartment(d: WorkpackPromptPack["department"]): string {
  switch (d) {
    case "sales":
      return "💼 Sales";
    case "finance":
      return "💵 Finance";
    case "email":
      return "✉️ Email";
    case "shipping":
      return "🚚 Shipping";
    case "marketing":
      return "📣 Marketing";
    case "research":
      return "🔬 Research";
    case "ops":
      return "🛠 Ops";
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function formatShortTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(11, 16) + "Z";
  } catch {
    return iso;
  }
}
