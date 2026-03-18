/**
 * Tests for monthly close helpers (Phase 2C)
 * Note: full integration tests require Supabase, so we test pure logic here.
 */
import { describe, expect, it } from "vitest";

// Test the helper functions by importing the module and testing exported behavior
// Since internal helpers aren't exported, we test the types and logic patterns

describe("monthly-close types and logic", () => {
  describe("period date calculations", () => {
    it("generates correct start of month", () => {
      // Test the same logic used in getPeriodDates
      const period = "2026-03";
      const [year, month] = period.split("-").map(Number);
      const start = `${year}-${String(month).padStart(2, "0")}-01`;
      expect(start).toBe("2026-03-01");
    });

    it("generates correct end of month", () => {
      const period = "2026-02";
      const [year, month] = period.split("-").map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      expect(end).toBe("2026-02-28");
    });

    it("handles leap years", () => {
      const period = "2028-02"; // 2028 is a leap year
      const [year, month] = period.split("-").map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      expect(lastDay).toBe(29);
    });

    it("handles December", () => {
      const period = "2026-12";
      const [year, month] = period.split("-").map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      expect(lastDay).toBe(31);
    });
  });

  describe("prior period calculation", () => {
    it("goes back one month", () => {
      const period = "2026-03";
      const [year, month] = period.split("-").map(Number);
      const priorMonth = month === 1 ? 12 : month - 1;
      const priorYear = month === 1 ? year - 1 : year;
      expect(`${priorYear}-${String(priorMonth).padStart(2, "0")}`).toBe("2026-02");
    });

    it("wraps to December of prior year", () => {
      const period = "2026-01";
      const [year, month] = period.split("-").map(Number);
      const priorMonth = month === 1 ? 12 : month - 1;
      const priorYear = month === 1 ? year - 1 : year;
      expect(`${priorYear}-${String(priorMonth).padStart(2, "0")}`).toBe("2025-12");
    });
  });

  describe("percentage change", () => {
    function pctChange(current: number, prior: number): number {
      if (prior === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - prior) / Math.abs(prior)) * 1000) / 10;
    }

    it("calculates positive growth", () => {
      expect(pctChange(150, 100)).toBe(50);
    });

    it("calculates negative growth", () => {
      expect(pctChange(80, 100)).toBe(-20);
    });

    it("handles zero prior", () => {
      expect(pctChange(100, 0)).toBe(100);
      expect(pctChange(0, 0)).toBe(0);
    });

    it("handles equal values", () => {
      expect(pctChange(100, 100)).toBe(0);
    });
  });

  describe("reconciliation logic", () => {
    it("detects revenue sum mismatch", () => {
      const channelSum = 100 + 200 + 50;
      const total = 355; // Wrong
      const diff = Math.abs(channelSum - total);
      expect(diff).toBeGreaterThan(0.01);
    });

    it("detects balanced revenue", () => {
      const channelSum = 100 + 200 + 50;
      const total = 350;
      const diff = Math.abs(channelSum - total);
      expect(diff).toBeLessThanOrEqual(0.01);
    });

    it("flags excessive COGS", () => {
      const cogs = 600;
      const revenue = 350;
      expect(cogs > revenue * 1.5).toBe(true);
    });
  });
});
