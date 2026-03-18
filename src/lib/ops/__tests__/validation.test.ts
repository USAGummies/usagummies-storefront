/**
 * Tests for Zod validation utility (Phase 1A)
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

// We test the schemas directly since validateRequest needs a full Request object
// Import the schemas from validation.ts
import {
  uuidSchema,
  emailSchema,
  dateSchema,
  currencySchema,
  positiveCurrencySchema,
  safeTextSchema,
  safeTitleSchema,
  notionPageIdSchema,
  departmentSchema,
  riskLevelSchema,
  confidenceSchema,
} from "@/lib/ops/validation";

describe("Zod validation schemas", () => {
  describe("uuidSchema", () => {
    it("accepts valid UUIDs", () => {
      expect(uuidSchema.safeParse("123e4567-e89b-12d3-a456-426614174000").success).toBe(true);
    });
    it("rejects invalid UUIDs", () => {
      expect(uuidSchema.safeParse("not-a-uuid").success).toBe(false);
      expect(uuidSchema.safeParse("").success).toBe(false);
    });
  });

  describe("emailSchema", () => {
    it("accepts valid emails", () => {
      expect(emailSchema.safeParse("ben@usagummies.com").success).toBe(true);
    });
    it("rejects invalid emails", () => {
      expect(emailSchema.safeParse("not-an-email").success).toBe(false);
      expect(emailSchema.safeParse("@no-user.com").success).toBe(false);
    });
    it("trims whitespace", () => {
      const result = emailSchema.safeParse("  ben@usagummies.com  ");
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe("ben@usagummies.com");
    });
  });

  describe("dateSchema", () => {
    it("accepts YYYY-MM-DD format", () => {
      expect(dateSchema.safeParse("2026-03-17").success).toBe(true);
    });
    it("rejects bad dates", () => {
      expect(dateSchema.safeParse("03/17/2026").success).toBe(false);
      expect(dateSchema.safeParse("2026-3-1").success).toBe(false);
    });
  });

  describe("currencySchema", () => {
    it("accepts zero and negative", () => {
      expect(currencySchema.safeParse(0).success).toBe(true);
      expect(currencySchema.safeParse(-50.25).success).toBe(true);
    });
    it("rejects non-numbers", () => {
      expect(currencySchema.safeParse("$50").success).toBe(false);
    });
  });

  describe("positiveCurrencySchema", () => {
    it("accepts positive amounts", () => {
      expect(positiveCurrencySchema.safeParse(100).success).toBe(true);
      expect(positiveCurrencySchema.safeParse(0.01).success).toBe(true);
    });
    it("accepts zero (non-negative)", () => {
      expect(positiveCurrencySchema.safeParse(0).success).toBe(true);
    });
    it("rejects negative", () => {
      expect(positiveCurrencySchema.safeParse(-1).success).toBe(false);
    });
  });

  describe("safeTextSchema", () => {
    it("accepts text within default limit", () => {
      const schema = safeTextSchema();
      expect(schema.safeParse("hello world").success).toBe(true);
    });
    it("allows empty strings (no min constraint)", () => {
      const schema = safeTextSchema();
      expect(schema.safeParse("   ").success).toBe(true);
    });
    it("respects custom max length", () => {
      const schema = safeTextSchema(10);
      expect(schema.safeParse("short").success).toBe(true);
      expect(schema.safeParse("this is too long for ten").success).toBe(false);
    });
  });

  describe("safeTitleSchema", () => {
    it("accepts titles under 200 chars", () => {
      const schema = safeTitleSchema();
      expect(schema.safeParse("My Title").success).toBe(true);
    });
    it("rejects titles over 200 chars", () => {
      const schema = safeTitleSchema();
      expect(schema.safeParse("a".repeat(201)).success).toBe(false);
    });
  });

  describe("notionPageIdSchema", () => {
    it("accepts 32-char hex strings", () => {
      expect(notionPageIdSchema.safeParse("3264c0c42c2e818fbeded95510413adb").success).toBe(true);
    });
    it("rejects UUID format with dashes", () => {
      expect(notionPageIdSchema.safeParse("3264c0c4-2c2e-818f-bede-d95510413adb").success).toBe(false);
    });
    it("rejects short strings", () => {
      expect(notionPageIdSchema.safeParse("abc123").success).toBe(false);
    });
  });

  describe("departmentSchema", () => {
    it("accepts known departments", () => {
      expect(departmentSchema.safeParse("finance").success).toBe(true);
      expect(departmentSchema.safeParse("sales_and_growth").success).toBe(true);
      expect(departmentSchema.safeParse("executive").success).toBe(true);
    });
    it("rejects unknown departments", () => {
      expect(departmentSchema.safeParse("janitorial").success).toBe(false);
    });
  });

  describe("riskLevelSchema", () => {
    it("accepts valid risk levels", () => {
      expect(riskLevelSchema.safeParse("low").success).toBe(true);
      expect(riskLevelSchema.safeParse("medium").success).toBe(true);
      expect(riskLevelSchema.safeParse("high").success).toBe(true);
    });
    it("rejects invalid risk levels", () => {
      expect(riskLevelSchema.safeParse("extreme").success).toBe(false);
    });
  });

  describe("confidenceSchema", () => {
    it("accepts 0-1 range", () => {
      expect(confidenceSchema.safeParse(0).success).toBe(true);
      expect(confidenceSchema.safeParse(0.5).success).toBe(true);
      expect(confidenceSchema.safeParse(1).success).toBe(true);
    });
    it("rejects out of range", () => {
      expect(confidenceSchema.safeParse(-0.1).success).toBe(false);
      expect(confidenceSchema.safeParse(1.1).success).toBe(false);
    });
  });
});
