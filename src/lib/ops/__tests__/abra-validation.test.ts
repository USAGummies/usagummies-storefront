import { describe, expect, it } from "vitest";
import {
  isAllowedEmailRecipient,
  isKnownDepartment,
  isValidDateString,
  isValidNotionPageId,
  isValidUUID,
  pgFilterValue,
  sanitizeText,
  sanitizeTitle,
} from "@/lib/ops/abra-validation";

describe("abra-validation", () => {
  it("accepts valid UUIDs", () => {
    expect(isValidUUID("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
  });

  it("rejects invalid UUIDs", () => {
    expect(isValidUUID("not-a-uuid")).toBe(false);
    expect(isValidUUID("123e4567")).toBe(false);
  });

  it("accepts valid Notion page IDs", () => {
    expect(isValidNotionPageId("3264c0c42c2e818fbeded95510413adb")).toBe(true);
  });

  it("rejects invalid Notion page IDs", () => {
    expect(isValidNotionPageId("3264c0c4-2c2e-818f-bede-d95510413adb")).toBe(false);
    expect(isValidNotionPageId("xyz")).toBe(false);
  });

  it("sanitizes long titles to 200 chars", () => {
    const value = "a".repeat(250);
    expect(sanitizeTitle(value)).toHaveLength(200);
  });

  it("sanitizes long text to 5000 chars", () => {
    const value = "b".repeat(6000);
    expect(sanitizeText(value)).toHaveLength(5000);
  });

  it("validates real date strings", () => {
    expect(isValidDateString("2026-03-17")).toBe(true);
  });

  it("rejects malformed date strings", () => {
    expect(isValidDateString("2026/03/17")).toBe(false);
    expect(isValidDateString("invalid")).toBe(false);
  });

  it("encodes PostgREST filter values safely", () => {
    expect(pgFilterValue("a+b c")).toBe("a%2Bb%20c");
  });

  it("validates known departments", () => {
    expect(isKnownDepartment("finance")).toBe(true);
    expect(isKnownDepartment("unknown")).toBe(false);
  });

  it("allows approved recipients and rejects unknown external domains", () => {
    expect(isAllowedEmailRecipient("ben@usagummies.com")).toBe(true);
    expect(isAllowedEmailRecipient("someone@gmail.com")).toBe(true);
    expect(isAllowedEmailRecipient("vendor@example.com")).toBe(false);
  });
});
