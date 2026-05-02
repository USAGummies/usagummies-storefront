import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();

vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
  },
}));

import {
  createWorkpack,
  listWorkpacks,
  updateWorkpack,
  validateWorkpackInput,
  WorkpackUpdateError,
} from "../workpacks";

beforeEach(() => {
  store.clear();
});

describe("validateWorkpackInput", () => {
  it("requires bounded structured intent input", () => {
    const r = validateWorkpackInput({
      intent: "send_email",
      title: "",
      sourceText: "",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues).toContain("invalid intent");
    expect(r.issues).toContain("title is required");
    expect(r.issues).toContain("sourceText is required");
  });

  it("adds default prohibitions so AI workers cannot execute sensitive actions", () => {
    const r = validateWorkpackInput({
      intent: "prepare_codex_prompt",
      department: "ops",
      title: "Wire Slack card",
      sourceText: "Build a safe Slack card",
      allowedActions: ["draft_only"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.prohibitedActions).toEqual(
      expect.arrayContaining([
        "send_email",
        "write_qbo",
        "change_shopify_pricing",
        "change_cart_or_checkout",
        "buy_shipping_label",
      ]),
    );
  });

  it("rejects non-http source URLs", () => {
    const r = validateWorkpackInput({
      intent: "summarize_thread",
      title: "Summarize",
      sourceText: "thread",
      sourceUrl: "slack://thread",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues).toContain("sourceUrl must be http(s)");
  });
});

describe("workpack storage", () => {
  it("creates queued workpacks and lists newest first", async () => {
    const a = await createWorkpack(
      {
        intent: "draft_reply",
        title: "Draft customer reply",
        sourceText: "Please answer this buyer",
      },
      { id: "wp_a", now: new Date("2026-05-02T10:00:00.000Z") },
    );
    const b = await createWorkpack(
      {
        intent: "prepare_codex_prompt",
        department: "ops",
        title: "Build prompt",
        sourceText: "Create a handoff",
      },
      { id: "wp_b", now: new Date("2026-05-02T11:00:00.000Z") },
    );

    expect(a.status).toBe("queued");
    expect(b.department).toBe("ops");
    const rows = await listWorkpacks();
    expect(rows.map((r) => r.id)).toEqual(["wp_b", "wp_a"]);
  });

  it("updates lifecycle metadata without changing guardrails", async () => {
    const original = await createWorkpack(
      {
        intent: "prepare_codex_prompt",
        department: "ops",
        title: "Build prompt",
        sourceText: "Create a handoff",
        allowedActions: ["prepare_prompt"],
      },
      { id: "wp_update", now: new Date("2026-05-02T10:00:00.000Z") },
    );

    const updated = await updateWorkpack(
      "wp_update",
      {
        status: "needs_review",
        assignedTo: "Codex",
        resultSummary: "Prompt is ready.",
        resultPrompt: "Continue from this exact handoff.",
        resultLinks: ["https://www.usagummies.com/ops/workpacks"],
      },
      { now: new Date("2026-05-02T11:00:00.000Z") },
    );

    expect(updated.status).toBe("needs_review");
    expect(updated.assignedTo).toBe("Codex");
    expect(updated.resultLinks).toEqual(["https://www.usagummies.com/ops/workpacks"]);
    expect(updated.allowedActions).toEqual(original.allowedActions);
    expect(updated.prohibitedActions).toEqual(original.prohibitedActions);
    expect(updated.updatedAt).toBe("2026-05-02T11:00:00.000Z");
  });

  it("stamps completedAt for terminal statuses and clears it when reopened", async () => {
    await createWorkpack(
      {
        intent: "summarize_thread",
        title: "Summarize",
        sourceText: "thread",
      },
      { id: "wp_done", now: new Date("2026-05-02T10:00:00.000Z") },
    );
    const done = await updateWorkpack(
      "wp_done",
      { status: "done" },
      { now: new Date("2026-05-02T11:00:00.000Z") },
    );
    expect(done.completedAt).toBe("2026-05-02T11:00:00.000Z");

    const reopened = await updateWorkpack(
      "wp_done",
      { status: "queued" },
      { now: new Date("2026-05-02T12:00:00.000Z") },
    );
    expect(reopened.completedAt).toBeUndefined();
  });

  it("rejects invalid result links and no-op patches", async () => {
    await createWorkpack(
      {
        intent: "research",
        title: "Research",
        sourceText: "find source",
      },
      { id: "wp_bad", now: new Date("2026-05-02T10:00:00.000Z") },
    );

    await expect(
      updateWorkpack("wp_bad", { resultLinks: ["slack://thread"] }),
    ).rejects.toMatchObject({ code: "invalid_links" });
    await expect(updateWorkpack("wp_bad", {})).rejects.toBeInstanceOf(
      WorkpackUpdateError,
    );
    await expect(updateWorkpack("wp_missing", { status: "running" })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
