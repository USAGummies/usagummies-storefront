/**
 * Phase 28L.3 — Stack-readiness manifest + helpers.
 *
 * Locks the contract:
 *   - Every service has the required manifest fields (id, name,
 *     layer, envVars, maturity 1-5, degradedMode, replacement).
 *   - Service ids are unique and kebab-case.
 *   - Layers come from the closed enum (compute / storage / integration /
 *     auth / marketplace).
 *   - checkEnvVars correctly identifies missing vars (and treats
 *     whitespace-only as missing).
 *   - combineProbeAndEnv pins env-missing → status="down" regardless
 *     of probe outcome.
 *   - summarizeStack counts each status correctly + computes mean
 *     maturity.
 *   - probeFetch maps thrown / rejected fetches to status="down"
 *     and never propagates the error.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STACK_SERVICES,
  checkEnvVars,
  combineProbeAndEnv,
  noProbe,
  probeFetch,
  summarizeStack,
  type StackProbeResult,
  type StackServiceManifest,
  type StackServiceRow,
} from "../stack-readiness";

const VALID_LAYERS = new Set([
  "compute",
  "storage",
  "integration",
  "auth",
  "marketplace",
]);

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("STACK_SERVICES manifest sanity", () => {
  it("has at least one service per layer we care about", () => {
    const layers = new Set(STACK_SERVICES.map((s) => s.layer));
    expect(layers.has("compute")).toBe(true);
    expect(layers.has("storage")).toBe(true);
    expect(layers.has("integration")).toBe(true);
    expect(layers.has("auth")).toBe(true);
    expect(layers.has("marketplace")).toBe(true);
  });

  it("has unique kebab-case ids and all required fields", () => {
    const ids = new Set<string>();
    for (const s of STACK_SERVICES) {
      expect(s.id).toMatch(KEBAB_CASE);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.name.length).toBeGreaterThan(0);
      expect(VALID_LAYERS.has(s.layer)).toBe(true);
      expect(Array.isArray(s.envVars)).toBe(true);
      expect(s.maturity).toBeGreaterThanOrEqual(1);
      expect(s.maturity).toBeLessThanOrEqual(5);
      expect(s.degradedMode.length).toBeGreaterThan(0);
      expect(s.replacement.length).toBeGreaterThan(0);
    }
  });

  it("does NOT include make-com (removed 2026-05-03 — Ben canceled subscription)", () => {
    // Regression guard: a future contributor must not re-add make-com
    // to the stack registry without unsubscribing the rest of the
    // stack-down brief plumbing first. The /api/leads webhook call
    // remains fail-soft via LEADS_WEBHOOK_URL — leaving that env var
    // unset is the canonical "off" state.
    const make = STACK_SERVICES.find((s) => s.id === "make-com");
    expect(make).toBeUndefined();
  });
});

describe("checkEnvVars", () => {
  const svc: StackServiceManifest = {
    id: "test-svc",
    name: "Test",
    layer: "integration",
    envVars: ["FOO", "BAR"],
    maturity: 1,
    degradedMode: "x",
    replacement: "y",
  };

  it("returns ok when all vars present", () => {
    expect(checkEnvVars(svc, { FOO: "1", BAR: "2" })).toEqual({
      envOk: true,
      envMissing: [],
    });
  });

  it("treats empty + whitespace-only as missing", () => {
    expect(checkEnvVars(svc, { FOO: "", BAR: "  " })).toEqual({
      envOk: false,
      envMissing: ["FOO", "BAR"],
    });
  });

  it("treats undefined as missing", () => {
    expect(checkEnvVars(svc, { FOO: "1" })).toEqual({
      envOk: false,
      envMissing: ["BAR"],
    });
  });

  it("services with no env vars are always ok", () => {
    const empty: StackServiceManifest = { ...svc, envVars: [] };
    expect(checkEnvVars(empty, {})).toEqual({ envOk: true, envMissing: [] });
  });
});

describe("combineProbeAndEnv", () => {
  const svc: StackServiceManifest = {
    id: "test-svc",
    name: "Test",
    layer: "integration",
    envVars: ["FOO"],
    maturity: 2,
    degradedMode: "x",
    replacement: "y",
  };

  const okProbe: StackProbeResult = {
    status: "ok",
    message: "200 OK in 80ms",
    latencyMs: 80,
    probedAt: "2026-04-27T00:00:00.000Z",
  };

  it("env-missing forces down even when probe is ok", () => {
    const row = combineProbeAndEnv(svc, okProbe, {
      envOk: false,
      envMissing: ["FOO"],
    });
    expect(row.status).toBe("down");
    expect(row.message).toContain("FOO");
    expect(row.envOk).toBe(false);
  });

  it("env-ok keeps probe verdict (ok)", () => {
    const row = combineProbeAndEnv(svc, okProbe, {
      envOk: true,
      envMissing: [],
    });
    expect(row.status).toBe("ok");
    expect(row.message).toBe("200 OK in 80ms");
  });

  it("env-ok preserves probe degraded / down / unprobed verdicts", () => {
    for (const status of ["degraded", "down", "unprobed"] as const) {
      const row = combineProbeAndEnv(
        svc,
        { ...okProbe, status, message: status },
        { envOk: true, envMissing: [] },
      );
      expect(row.status).toBe(status);
    }
  });

  it("merges manifest + probe + env into a complete row", () => {
    const row: StackServiceRow = combineProbeAndEnv(svc, okProbe, {
      envOk: true,
      envMissing: [],
    });
    expect(row.id).toBe("test-svc");
    expect(row.name).toBe("Test");
    expect(row.layer).toBe("integration");
    expect(row.maturity).toBe(2);
    expect(row.envOk).toBe(true);
    expect(row.envMissing).toEqual([]);
    expect(row.latencyMs).toBe(80);
    expect(row.probedAt).toBe("2026-04-27T00:00:00.000Z");
  });
});

describe("summarizeStack", () => {
  const baseManifest: StackServiceManifest = {
    id: "x",
    name: "x",
    layer: "integration",
    envVars: [],
    maturity: 1,
    degradedMode: "x",
    replacement: "y",
  };

  function makeRow(
    overrides: Partial<StackServiceRow> & { id: string },
  ): StackServiceRow {
    return {
      ...baseManifest,
      status: "ok",
      message: "",
      latencyMs: null,
      probedAt: "",
      envOk: true,
      envMissing: [],
      ...overrides,
    };
  }

  it("counts each status and averages maturity", () => {
    const rows: StackServiceRow[] = [
      makeRow({ id: "a", status: "ok", maturity: 1 }),
      makeRow({ id: "b", status: "ok", maturity: 2 }),
      makeRow({ id: "c", status: "degraded", maturity: 3 }),
      makeRow({ id: "d", status: "down", maturity: 5 }),
      makeRow({ id: "e", status: "unprobed", maturity: 4 }),
    ];
    const s = summarizeStack(rows);
    expect(s.total).toBe(5);
    expect(s.ok).toBe(2);
    expect(s.degraded).toBe(1);
    expect(s.down).toBe(1);
    expect(s.unprobed).toBe(1);
    expect(s.averageMaturity).toBe(3);
  });

  it("returns zero average for an empty list (no NaN)", () => {
    const s = summarizeStack([]);
    expect(s.total).toBe(0);
    expect(s.averageMaturity).toBe(0);
  });
});

describe("noProbe", () => {
  it("returns an unprobed result with the given message + a real timestamp", () => {
    const r = noProbe("not implemented");
    expect(r.status).toBe("unprobed");
    expect(r.message).toBe("not implemented");
    expect(r.latencyMs).toBe(null);
    expect(() => new Date(r.probedAt).toISOString()).not.toThrow();
  });
});

describe("probeFetch", () => {
  it("maps a successful 200 response to status=ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => "OK",
      })),
    );
    const r = await probeFetch({ url: "https://example.com/health" });
    expect(r.status).toBe("ok");
    expect(r.message).toContain("200");
    expect(r.latencyMs).not.toBe(null);
  });

  it("maps a non-2xx to status=down with HTTP code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        text: async () => "down",
      })),
    );
    const r = await probeFetch({ url: "https://example.com/health" });
    expect(r.status).toBe("down");
    expect(r.message).toContain("503");
  });

  it("respects okPredicate over res.ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => "auth required",
      })),
    );
    const r = await probeFetch({
      url: "https://example.com/health",
      okPredicate: (status) => status === 401,
    });
    expect(r.status).toBe("ok");
  });

  it("never throws on fetch rejection — surfaces as down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ENETUNREACH");
      }),
    );
    const r = await probeFetch({ url: "https://example.com/health" });
    expect(r.status).toBe("down");
    expect(r.message).toContain("ENETUNREACH");
    expect(r.latencyMs).not.toBe(null);
  });
});
