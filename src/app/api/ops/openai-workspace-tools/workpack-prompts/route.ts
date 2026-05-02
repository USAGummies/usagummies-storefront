/**
 * GET /api/ops/openai-workspace-tools/workpack-prompts
 *
 * Read-only registry of per-department workpack prompt packs. External
 * AI tools (ChatGPT workspace agents, Claude Code, Codex) GET this
 * endpoint to discover what they're allowed to do in each lane —
 * role, read tools, allowed outputs, prohibited actions, approval
 * slugs, daily checklist, human-handoff shape.
 *
 * Build 6 finish per docs/SYSTEM_BUILD_CONTINUATION_BLUEPRINT.md §4.
 *
 * Hard rules:
 *   - Auth-gated.
 *   - Read-only — never executes anything; just publishes the static
 *     prompt-pack registry.
 *   - No QBO / HubSpot / Shopify / Gmail imports.
 *
 * Query params:
 *   - department: optional filter to a specific department
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  PROHIBITED_GLOBAL,
  WORKPACK_PROMPT_PACKS,
  WORKPACK_PROMPT_PACK_BY_DEPARTMENT,
  type WorkpackPromptDepartment,
} from "@/lib/ops/workpack-prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_DEPARTMENTS: ReadonlySet<WorkpackPromptDepartment> = new Set([
  "sales",
  "finance",
  "email",
  "shipping",
  "marketing",
  "research",
  "ops",
]);

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dept = url.searchParams.get("department");
  if (dept) {
    if (!VALID_DEPARTMENTS.has(dept as WorkpackPromptDepartment)) {
      return NextResponse.json(
        {
          error: `department must be one of: ${Array.from(VALID_DEPARTMENTS).join(", ")}`,
        },
        { status: 400 },
      );
    }
    const pack =
      WORKPACK_PROMPT_PACK_BY_DEPARTMENT[
        dept as WorkpackPromptDepartment
      ];
    if (!pack) {
      return NextResponse.json(
        {
          ok: true,
          department: dept,
          pack: null,
          note: "No prompt pack registered for this department yet.",
          prohibitedGlobal: PROHIBITED_GLOBAL,
        },
        { status: 200 },
      );
    }
    return NextResponse.json({
      ok: true,
      pack,
      prohibitedGlobal: PROHIBITED_GLOBAL,
    });
  }

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    packs: WORKPACK_PROMPT_PACKS,
    prohibitedGlobal: PROHIBITED_GLOBAL,
    notes: {
      doctrine:
        "Build 6 per docs/SYSTEM_BUILD_CONTINUATION_BLUEPRINT.md. Each pack is read-only doctrine — agents that consume them are external (ChatGPT workspace, Claude Code, Codex).",
      execution:
        "Pack approval slugs are SUGGESTIONS — actual execution still goes through the canonical Class B/C approval flow on the repo side. External tools propose; operators promote.",
    },
  });
}
