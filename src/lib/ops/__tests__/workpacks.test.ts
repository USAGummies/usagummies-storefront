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
  validateWorkpackInput,
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
});
