/**
 * Phase 29 — Drew doctrine lock.
 *
 * Ben's correction (2026-04-27): "drew owns nothing." Drew is a
 * fulfillment node for samples + East Coast destinations only — NOT
 * an approver, NOT an agent owner, NOT a Class B/C requiredApprover.
 *
 * This test asserts the invariant. If Drew shows up as an approver
 * in the canonical taxonomy or a compliance-doctrine owner, the
 * suite breaks — forcing a deliberate doctrinal reversal rather
 * than silent regression.
 */
import { describe, expect, it } from "vitest";

import { ACTION_REGISTRY } from "../control-plane/taxonomy";
import { COMPLIANCE_DOCTRINE } from "../compliance-doctrine";
import { AGENT_MANIFEST } from "../agent-health";

describe('"drew owns nothing" — Phase 29 doctrine lock', () => {
  it("no taxonomy slug names Drew as a required approver", () => {
    const offenders = ACTION_REGISTRY.filter((entry) =>
      (entry.requiredApprovers ?? []).includes("Drew" as never),
    );
    if (offenders.length > 0) {
      const slugs = offenders.map((o) => o.slug).join(", ");
      throw new Error(
        `Drew named as approver on slug(s): ${slugs}. Per Ben 2026-04-27 "drew owns nothing." Reassign to Ben (Class B) or Ben+Rene (Class C dual).`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it("no compliance requirement names Drew as owner", () => {
    const offenders = COMPLIANCE_DOCTRINE.filter(
      (r) => r.owner === ("Drew" as never),
    );
    if (offenders.length > 0) {
      const ids = offenders.map((o) => o.id).join(", ");
      throw new Error(
        `Drew named as owner on compliance requirement(s): ${ids}. Per Ben 2026-04-27 "drew owns nothing." Reassign to Ben.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it("no agent manifest entry names Drew as owner", () => {
    const offenders = AGENT_MANIFEST.filter((a) => a.owner === "drew");
    if (offenders.length > 0) {
      const ids = offenders.map((o) => o.id).join(", ");
      throw new Error(
        `Drew named as agent owner on agent(s): ${ids}. Per Ben 2026-04-27 "drew owns nothing." Reassign to Ben/Rene/Claude.`,
      );
    }
    expect(offenders).toEqual([]);
  });
});
