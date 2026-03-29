import { describe, expect, it, vi } from "vitest";
import { deriveTaskTitle, extractNotionPageId } from "@/lib/ops/abra-action-helpers";
import { buildAbraSystemPrompt } from "@/lib/ops/abra-system-prompt";

vi.mock("server-only", () => ({}));

const { normalizeActionDirective, parseActionDirectives, stripActionBlocks } = await import("@/lib/ops/abra-actions");

describe("abra action reliability", () => {
  it("derives a sane task title from conversational text", () => {
    expect(
      deriveTaskTitle({
        description: "create a task to follow up with Greg next Tuesday.",
      }),
    ).toBe("Follow up with Greg next Tuesday");
  });

  it("maps top-level create_task title into params for execution", () => {
    const action = normalizeActionDirective({
      action_type: "create_task",
      title: "follow up with Greg",
      description: "Create a task for Greg follow-up",
      risk_level: "low",
    });

    expect(action).not.toBeNull();
    expect(action?.params.title).toBe("follow up with Greg");
  });

  it("extracts a Notion page id from a shared URL", () => {
    expect(
      extractNotionPageId(
        "https://www.notion.so/TEST-Chart-of-Accounts-3284c0c42c2e81b1bfdbd763ce1497cd?foo=bar",
      ),
    ).toBe("3284c0c42c2e81b1bfdbd763ce1497cd");
  });

  it("allows update_notion to normalize a url into params.page_id", () => {
    const action = normalizeActionDirective({
      action_type: "update_notion",
      description:
        "update this Notion page to say shipped: https://www.notion.so/TEST-Chart-of-Accounts-3284c0c42c2e81b1bfdbd763ce1497cd",
      risk_level: "low",
    });

    expect(action).not.toBeNull();
    expect(action?.params.page_id).toBe("3284c0c42c2e81b1bfdbd763ce1497cd");
  });

  it("states that direct @Abra mentions must always get a response", () => {
    const prompt = buildAbraSystemPrompt({ format: "slack" });
    expect(prompt).toContain("If Abra is directly mentioned (@Abra or <@U0AKMSTL0GL>), ALWAYS respond.");
    expect(prompt).toContain("If a message mentions Ben or another human but still asks Abra for help, respond normally.");
  });

  it("parses loose create_task xml blocks and strips them from the visible reply", () => {
    const reply = `I'll handle that.\n<create_task>\ntitle: Review Q1 financials\ndescription: Create a task for Rene\n</create_task>`;
    const parsed = parseActionDirectives(reply);

    expect(parsed.actions).toHaveLength(1);
    expect(parsed.actions[0]?.action.action_type).toBe("create_task");
    expect(parsed.actions[0]?.action.params.title).toBe("Review Q1 financials");
    expect(parsed.cleanReply).toBe("I'll handle that.");
    expect(stripActionBlocks(reply)).toBe("I'll handle that.");
  });
});
