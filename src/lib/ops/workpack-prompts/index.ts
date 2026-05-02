/**
 * Workpack Prompt Packs — Build 6 finish.
 *
 * Per docs/SYSTEM_BUILD_CONTINUATION_BLUEPRINT.md §4 Build 6:
 *
 *   "Make ChatGPT workspace agents useful without giving them unsafe
 *   write access. … curated workpack per department; allowed reads /
 *   allowed writes / prohibited actions per workpack; prompts that
 *   ChatGPT workspace agents can use reliably; heartbeat outputs
 *   written to audit/status; clear human handoff object when an agent
 *   cannot act."
 *
 * Each prompt pack is a STATIC CONFIG describing what an external AI
 * tool (ChatGPT workspace agents, Claude Code, Codex) can do in a
 * specific department's lane:
 *   - role:                short identity statement
 *   - readTools:           the openai-workspace-tools read endpoints
 *                          this pack may call
 *   - allowedOutputs:      shapes the agent may emit (drafts, summaries,
 *                          proposals, prompts)
 *   - prohibitedActions:   structural NO list (never overrides global
 *                          prohibitions, just makes them explicit)
 *   - approvalSlugs:       canonical approval slugs the agent may open
 *                          via the /api/ops/external-proposals lane
 *   - dailyChecklist:      one-paragraph instructions an agent can
 *                          paste into a daily run
 *   - humanHandoff:        the object an agent emits when it cannot
 *                          act (e.g. KV unreachable, doctrine block)
 *
 * Purely declarative. No I/O. The route layer reads + serves; the
 * agents that consume them are external (ChatGPT workspace, etc).
 *
 * Hard rules baked in:
 *   - Every prompt pack inherits the global PROHIBITED_GLOBAL list
 *     (never sends Gmail, never QBO write, never Shopify
 *     cart/pricing/checkout/product mutation, never ad spend launch,
 *     never label buy without operator approval).
 *   - Approval slugs MUST be drawn from the canonical taxonomy. Adding
 *     a slug here doesn't bypass approval; it just says "this pack
 *     may suggest opening this approval."
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkpackPromptDepartment =
  | "sales"
  | "finance"
  | "email"
  | "shipping"
  | "marketing"
  | "research"
  | "ops";

export interface WorkpackPromptHumanHandoff {
  /** Stable handoff slug — e.g. "operator-review", "rene-review", "ben-decision". */
  slug: string;
  /** What the agent should write into the handoff object. */
  fields: ReadonlyArray<string>;
}

export interface WorkpackPromptPack {
  department: WorkpackPromptDepartment;
  /** One-line agent role statement. */
  role: string;
  /** Read-only API endpoints the pack may call. */
  readTools: ReadonlyArray<string>;
  /** Output shapes the agent may emit. */
  allowedOutputs: ReadonlyArray<string>;
  /** Department-specific prohibited actions (in addition to global). */
  prohibitedActions: ReadonlyArray<string>;
  /** Approval slugs the pack may suggest opening. */
  approvalSlugs: ReadonlyArray<string>;
  /** Daily run prompt — an agent pastes this verbatim to do a check-in. */
  dailyChecklist: string;
  /** Human handoff shape when the agent can't act. */
  humanHandoff: WorkpackPromptHumanHandoff;
}

/**
 * Global prohibition list — applies to EVERY pack regardless of
 * department. The route exposes this so consumers see the full
 * forbidden surface, not just the dept-specific extras.
 */
export const PROHIBITED_GLOBAL: ReadonlyArray<string> = [
  "Send Gmail / email of any kind without an explicit Class B/C approval slug + repo-native execution",
  "Mutate HubSpot deal stage, contact properties, or owner without an operator-promoted proposal",
  "Write to QBO (vendor / bill / invoice / payment / journal entry) — Rene's review is required",
  "Mutate Shopify cart, pricing, checkout, product catalog, or inventory rules",
  "Buy a ShipStation label without a Class B `shipment.create` approval",
  "Launch / change Meta / Google / TikTok ad spend or campaign settings",
  "Charge a card or post a payment of any kind",
  "Delete records, packets, or audit entries",
  "Bypass an existing approval that is in `pending` status",
];

// ---------------------------------------------------------------------------
// Per-department packs
// ---------------------------------------------------------------------------

import { SALES_PACK } from "./sales";
import { FINANCE_PACK } from "./finance";
import { EMAIL_PACK } from "./email";
import { SHIPPING_PACK } from "./shipping";
import { MARKETING_PACK } from "./marketing";

export {
  SALES_PACK,
  FINANCE_PACK,
  EMAIL_PACK,
  SHIPPING_PACK,
  MARKETING_PACK,
};

export const WORKPACK_PROMPT_PACKS: ReadonlyArray<WorkpackPromptPack> = [
  SALES_PACK,
  FINANCE_PACK,
  EMAIL_PACK,
  SHIPPING_PACK,
  MARKETING_PACK,
];

export const WORKPACK_PROMPT_PACK_BY_DEPARTMENT: Readonly<
  Record<WorkpackPromptDepartment, WorkpackPromptPack | undefined>
> = (() => {
  const map: Record<string, WorkpackPromptPack | undefined> = {};
  for (const p of WORKPACK_PROMPT_PACKS) map[p.department] = p;
  return map as Record<WorkpackPromptDepartment, WorkpackPromptPack | undefined>;
})();

// ---------------------------------------------------------------------------
// Doctrine validators (locked by tests)
// ---------------------------------------------------------------------------

/** Returns true iff every pack's department appears at most once. */
export function packsHaveUniqueDepartments(
  packs: ReadonlyArray<WorkpackPromptPack> = WORKPACK_PROMPT_PACKS,
): boolean {
  const seen = new Set<string>();
  for (const p of packs) {
    if (seen.has(p.department)) return false;
    seen.add(p.department);
  }
  return true;
}

/**
 * Returns the list of department-specific prohibited actions that
 * appear NOT to overlap with the global prohibitions. We expect every
 * pack to have at least one dept-specific rule that ISN'T already
 * covered globally — otherwise the pack adds no doctrine value.
 */
export function packsHaveDeptSpecificProhibitions(
  packs: ReadonlyArray<WorkpackPromptPack> = WORKPACK_PROMPT_PACKS,
): boolean {
  for (const p of packs) {
    const distinct = p.prohibitedActions.filter(
      (rule) =>
        !PROHIBITED_GLOBAL.some((g) =>
          rule.toLowerCase().includes(g.toLowerCase().slice(0, 20)),
        ),
    );
    if (distinct.length === 0) return false;
  }
  return true;
}

/**
 * Read tool sanity check: every pack's readTools must start with
 * `/api/ops/` (no external tool URLs, no third-party endpoints).
 */
export function packReadToolsAreLocal(
  packs: ReadonlyArray<WorkpackPromptPack> = WORKPACK_PROMPT_PACKS,
): boolean {
  for (const p of packs) {
    for (const url of p.readTools) {
      if (!url.startsWith("/api/ops/")) return false;
    }
  }
  return true;
}
