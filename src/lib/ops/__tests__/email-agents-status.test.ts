import { describe, expect, it } from "vitest";

import {
  deriveEmailAgentsStatus,
  isTruthy,
} from "../email-agents-status";

const INCIDENT = `
- [x] **Classifier fix shipped + tested.** Done.
- [x] **Template audit complete.** Done.
- [ ] **Approval-gate audit complete.** Pending.
`;

const INCIDENT_ALL_CLEAR = INCIDENT.replace("[ ] **Approval-gate", "[x] **Approval-gate");

const SYSTEM = `**Schema status:** ✅ The 9 missing custom properties + 2 property groups were created via API.`;
const HUBSPOT = `**Status of gate:** ✅ UNBLOCKED. Properties were created.`;

function status(overrides: Partial<Parameters<typeof deriveEmailAgentsStatus>[0]> = {}) {
  return deriveEmailAgentsStatus(
    {
      incidentMarkdown: INCIDENT,
      systemMarkdown: SYSTEM,
      hubspotPropertyMarkdown: HUBSPOT,
      vercelJson: JSON.stringify({ crons: [] }),
      env: {},
      ...overrides,
    },
    { now: new Date("2026-04-30T20:00:00.000Z") },
  );
}

describe("email-agents status derivation", () => {
  it("detects truthy env values narrowly", () => {
    expect(isTruthy("true")).toBe(true);
    expect(isTruthy("1")).toBe(true);
    expect(isTruthy("on")).toBe(true);
    expect(isTruthy(" yes ")).toBe(false);
    expect(isTruthy(undefined)).toBe(false);
  });

  it("stays blocked while approval-gate audit is unchecked", () => {
    const result = status();
    expect(result.readiness).toBe("blocked");
    expect(result.enabled).toBe(false);
    expect(result.cronConfigured).toBe(false);
    expect(result.hubspotSchemaReady).toBe(true);
    expect(result.blockers).toEqual([
      expect.stringContaining("Approval-gate audit complete"),
    ]);
  });

  it("becomes ready_for_dry_run when doctrine gates are clear and runner is off", () => {
    const result = status({ incidentMarkdown: INCIDENT_ALL_CLEAR });
    expect(result.readiness).toBe("ready_for_dry_run");
    expect(result.nextSafeAction).toMatch(/dry-run/i);
  });

  it("reports active only when all gates are clear, runner is enabled, and cron is configured", () => {
    const result = status({
      incidentMarkdown: INCIDENT_ALL_CLEAR,
      env: { EMAIL_INTEL_ENABLED: "true" },
      vercelJson: JSON.stringify({
        crons: [{ path: "/api/ops/fulfillment/email-intel/run" }],
      }),
    });
    expect(result.readiness).toBe("active");
    expect(result.enabled).toBe(true);
    expect(result.cronConfigured).toBe(true);
  });

  it("flags enabled runner without all gates as misconfigured", () => {
    const result = status({ env: { EMAIL_INTEL_ENABLED: "on" } });
    expect(result.readiness).toBe("misconfigured");
    expect(result.blockers).toEqual([
      expect.stringContaining("Approval-gate audit complete"),
      expect.stringContaining("Email-intel kill switch remains off"),
    ]);
  });

  it("does not treat missing HubSpot schema documentation as ready", () => {
    const result = status({
      incidentMarkdown: INCIDENT_ALL_CLEAR,
      hubspotPropertyMarkdown: "",
      systemMarkdown: "",
    });
    expect(result.readiness).toBe("blocked");
    expect(result.gates.find((g) => g.id === "hubspot_schema")?.ok).toBe(false);
  });

  it("returns deterministic generatedAt when now is supplied", () => {
    expect(status().generatedAt).toBe("2026-04-30T20:00:00.000Z");
  });
});
