/**
 * Tests for error tracker (Phase 6B)
 */
import { describe, expect, it } from "vitest";
import { trackError } from "@/lib/ops/error-tracker";

describe("error-tracker", () => {
  it("accepts Error objects without throwing", () => {
    expect(() => {
      trackError(new Error("test error"), "test-suite");
    }).not.toThrow();
  });

  it("accepts string errors", () => {
    expect(() => {
      trackError("string error message", "test-suite");
    }).not.toThrow();
  });

  it("accepts all severity levels", () => {
    const severities = ["critical", "error", "warning", "info"] as const;
    for (const severity of severities) {
      expect(() => {
        trackError(new Error(`${severity} test`), "test-suite", severity);
      }).not.toThrow();
    }
  });

  it("accepts metadata", () => {
    expect(() => {
      trackError(new Error("with metadata"), "test-suite", "error", {
        userId: "123",
        route: "/api/test",
      });
    }).not.toThrow();
  });
});
