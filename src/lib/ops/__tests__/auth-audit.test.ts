/**
 * Tests for auth audit system (Phase 7A)
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { logAuthEvent, extractIP, extractUserAgent } from "@/lib/ops/auth-audit";

describe("auth-audit", () => {
  describe("extractIP", () => {
    it("extracts from x-forwarded-for", () => {
      const req = new Request("https://example.com", {
        headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      });
      expect(extractIP(req)).toBe("1.2.3.4");
    });

    it("extracts from x-real-ip", () => {
      const req = new Request("https://example.com", {
        headers: { "x-real-ip": "10.0.0.1" },
      });
      expect(extractIP(req)).toBe("10.0.0.1");
    });

    it("returns unknown when no headers", () => {
      const req = new Request("https://example.com");
      expect(extractIP(req)).toBe("unknown");
    });
  });

  describe("extractUserAgent", () => {
    it("returns user agent string", () => {
      const req = new Request("https://example.com", {
        headers: { "user-agent": "Mozilla/5.0 Test Browser" },
      });
      expect(extractUserAgent(req)).toBe("Mozilla/5.0 Test Browser");
    });

    it("truncates long user agents", () => {
      const longUA = "x".repeat(300);
      const req = new Request("https://example.com", {
        headers: { "user-agent": longUA },
      });
      expect(extractUserAgent(req).length).toBe(200);
    });

    it("returns unknown when missing", () => {
      const req = new Request("https://example.com");
      expect(extractUserAgent(req)).toBe("unknown");
    });
  });

  describe("logAuthEvent", () => {
    it("accepts valid event entries without throwing", () => {
      expect(() => {
        logAuthEvent({
          event_type: "login_success",
          user_email: "ben@usagummies.com",
          user_id: "123",
          user_role: "admin",
        });
      }).not.toThrow();
    });

    it("accepts all event types", () => {
      const events = [
        "login_success",
        "login_failure",
        "session_expired",
        "role_check_denied",
        "break_glass_used",
        "unauthorized_api_access",
        "rate_limited",
        "password_changed",
        "user_created",
        "user_deactivated",
      ] as const;

      for (const event of events) {
        expect(() => {
          logAuthEvent({ event_type: event });
        }).not.toThrow();
      }
    });
  });
});
