import { describe, expect, it } from "vitest";
import {
  ActionSchemas,
  CreateBrainEntrySchema,
  DraftEmailReplySchema,
  RecordTransactionSchema,
  SearchEmailSchema,
  SendEmailSchema,
  SendSlackSchema,
  UpdateNotionSchema,
  validateActionParams,
} from "@/lib/ops/abra-schemas";

describe("abra-schemas", () => {
  it("exports the expected action schemas", () => {
    expect(Object.keys(ActionSchemas)).toContain("send_slack");
    expect(Object.keys(ActionSchemas)).toContain("query_ledger");
  });

  it("validates send_slack payloads", () => {
    const parsed = SendSlackSchema.parse({ channel: "alerts", message: "Heads up" });
    expect(parsed.channel).toBe("alerts");
  });

  it("rejects invalid send_email payloads", () => {
    const result = SendEmailSchema.safeParse({ to: "bad-email", subject: "Hi", body: "Test" });
    expect(result.success).toBe(false);
  });

  it("validates draft email replies", () => {
    const parsed = DraftEmailReplySchema.parse({
      to: "person@example.com",
      subject: "Re: Hello",
      body: "Thanks",
      source_email_id: "thread-123",
    });
    expect(parsed.source_email_id).toBe("thread-123");
  });

  it("accepts hyphenated Notion page IDs for update_notion", () => {
    const result = UpdateNotionSchema.safeParse({
      page_id: "3264c0c4-2c2e-818f-bede-d95510413adb",
      content: "Updated content",
    });
    expect(result.success).toBe(true);
  });

  it("applies defaults for create_brain_entry", () => {
    const parsed = CreateBrainEntrySchema.parse({
      title: "Market note",
      text: "New distributor insight",
    });
    expect(parsed.category).toBe("general");
    expect(parsed.entry_type).toBe("finding");
  });

  it("validates record_transaction boundaries", () => {
    const parsed = RecordTransactionSchema.parse({
      date: "2026-03-17",
      amount: 125.5,
      type: "expense",
      description: "Packaging samples",
    });
    expect(parsed.amount).toBe(125.5);
  });

  it("rejects oversized search_email limits", () => {
    const result = SearchEmailSchema.safeParse({ query: "pricing", limit: 100 });
    expect(result.success).toBe(false);
  });

  it("returns human-readable errors from validateActionParams", () => {
    const result = validateActionParams("send_email", {
      to: "bad-email",
      subject: "Hello",
      body: "World",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("to");
    }
  });

  it("passes through unknown action types safely", () => {
    const result = validateActionParams("unknown_action", { anything: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ anything: true });
    }
  });
});
