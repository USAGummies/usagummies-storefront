/**
 * Phase 30.3 — Inbox triage closed-loop selectors.
 *
 * Locks the contract:
 *   - computeBacklogState routes each ScannedEmail to the correct
 *     BacklogState given hasDraft / hasApproval / category /
 *     requiresApproval / isApprovalTerminal.
 *   - junk_fyi short-circuits regardless of other state.
 *   - summarizeBacklog counts reconcile to total + bucket counts
 *     match per-category and per-urgency.
 *   - oldestAwaitingHours surfaces only awaiting-decision rows;
 *     null when none.
 *   - pickStaleAwaiting sorts urgency-first then oldest-first;
 *     respects limit; only includes rows whose age exceeds the
 *     per-urgency threshold.
 *   - renderBacklogBriefLine quiet-collapses to "" when nothing's
 *     awaiting; otherwise emits the canonical brief format.
 *   - defaultUrgencyForCategory + defaultRequiresApproval honor the
 *     existing email-intelligence taxonomy.
 */
import { describe, expect, it } from "vitest";

import type { ScannedEmail } from "../email-intelligence/report";
import type { EmailEnvelope } from "../gmail-reader";
import {
  STALE_HOURS_BY_URGENCY,
  ageHoursSince,
  computeBacklogState,
  defaultRequiresApproval,
  defaultUrgencyForCategory,
  pickStaleAwaiting,
  projectBacklogRow,
  projectBacklogRows,
  renderBacklogBriefLine,
  summarizeBacklog,
  type BacklogClassifierInput,
  type BacklogRow,
} from "../inbox-triage-backlog";

const NOW = new Date("2026-04-27T16:00:00.000Z");

function envelope(overrides: Partial<EmailEnvelope> = {}): EmailEnvelope {
  return {
    id: overrides.id ?? "msg-1",
    threadId: "thr-1",
    from: overrides.from ?? "alice@example.com",
    to: "ben@usagummies.com",
    subject: overrides.subject ?? "Test",
    date: overrides.date ?? new Date(NOW.getTime() - 3600_000).toISOString(),
    snippet: "...",
    labelIds: [],
  };
}

function scanned(overrides: Partial<ScannedEmail> = {}): ScannedEmail {
  return {
    envelope: overrides.envelope ?? envelope(),
    classification: overrides.classification ?? {
      category: "b2b_sales",
      confidence: 0.9,
      reason: "rule",
      ruleId: "domain",
    },
    alreadyEngaged: false,
    hasDraft: overrides.hasDraft ?? false,
    hasApproval: overrides.hasApproval ?? false,
    approvalId: overrides.approvalId ?? null,
    draftId: null,
  };
}

const cfg: BacklogClassifierInput = {
  requiresApproval: defaultRequiresApproval,
  isApprovalTerminal: (id) => id === "TERMINAL",
  urgencyFor: (s) => defaultUrgencyForCategory(s.classification.category),
};

describe("ageHoursSince", () => {
  it("returns positive integer hours for past timestamps", () => {
    expect(
      ageHoursSince(new Date(NOW.getTime() - 3 * 3600_000).toISOString(), NOW),
    ).toBe(3);
  });

  it("clamps negative (future) to 0", () => {
    expect(
      ageHoursSince(new Date(NOW.getTime() + 3600_000).toISOString(), NOW),
    ).toBe(0);
  });

  it("returns null for missing or unparseable input", () => {
    expect(ageHoursSince(null, NOW)).toBe(null);
    expect(ageHoursSince(undefined, NOW)).toBe(null);
    expect(ageHoursSince("not-a-date", NOW)).toBe(null);
  });
});

describe("defaultUrgencyForCategory", () => {
  it("shipping_issue + ap_finance map to high", () => {
    expect(defaultUrgencyForCategory("shipping_issue")).toBe("high");
    expect(defaultUrgencyForCategory("ap_finance")).toBe("high");
  });

  it("b2b_sales + sample_request + vendor_supply map to medium", () => {
    expect(defaultUrgencyForCategory("b2b_sales")).toBe("medium");
    expect(defaultUrgencyForCategory("sample_request")).toBe("medium");
    expect(defaultUrgencyForCategory("vendor_supply")).toBe("medium");
  });

  it("low-touch categories map to low", () => {
    expect(defaultUrgencyForCategory("customer_support")).toBe("low");
    expect(defaultUrgencyForCategory("marketing_pr")).toBe("low");
    expect(defaultUrgencyForCategory("junk_fyi")).toBe("low");
  });
});

describe("defaultRequiresApproval", () => {
  it("Class B email categories require approval", () => {
    for (const cat of [
      "b2b_sales",
      "ap_finance",
      "vendor_supply",
      "sample_request",
      "shipping_issue",
      "marketing_pr",
    ] as const) {
      expect(defaultRequiresApproval(cat)).toBe(true);
    }
  });

  it("low-touch / junk categories do not require approval", () => {
    expect(defaultRequiresApproval("customer_support")).toBe(false);
    expect(defaultRequiresApproval("receipt_document")).toBe(false);
    expect(defaultRequiresApproval("junk_fyi")).toBe(false);
  });
});

describe("computeBacklogState", () => {
  it("junk_fyi short-circuits to junk", () => {
    const s = scanned({
      classification: {
        category: "junk_fyi",
        confidence: 0.9,
        reason: "x",
        ruleId: "x",
      },
      hasDraft: true,
      hasApproval: true,
      approvalId: "TERMINAL",
    });
    expect(computeBacklogState(s, cfg)).toBe("junk");
  });

  it("approval present + terminal → handled", () => {
    const s = scanned({ hasApproval: true, approvalId: "TERMINAL" });
    expect(computeBacklogState(s, cfg)).toBe("handled");
  });

  it("approval present + NOT terminal → awaiting-decision", () => {
    const s = scanned({ hasApproval: true, approvalId: "PENDING" });
    expect(computeBacklogState(s, cfg)).toBe("awaiting-decision");
  });

  it("draft present + requiresApproval → awaiting-decision", () => {
    const s = scanned({
      hasDraft: true,
      // b2b_sales requires approval per default
    });
    expect(computeBacklogState(s, cfg)).toBe("awaiting-decision");
  });

  it("draft present + NOT requiresApproval → fyi-only", () => {
    const s = scanned({
      hasDraft: true,
      classification: {
        category: "customer_support",
        confidence: 0.9,
        reason: "x",
        ruleId: "x",
      },
    });
    expect(computeBacklogState(s, cfg)).toBe("fyi-only");
  });

  it("no draft + no approval + NOT requiresApproval → fyi-only", () => {
    const s = scanned({
      classification: {
        category: "customer_support",
        confidence: 0.9,
        reason: "x",
        ruleId: "x",
      },
    });
    expect(computeBacklogState(s, cfg)).toBe("fyi-only");
  });

  it("no draft + no approval + requiresApproval → awaiting-decision", () => {
    const s = scanned();
    expect(computeBacklogState(s, cfg)).toBe("awaiting-decision");
  });
});

describe("projectBacklogRow + summarizeBacklog", () => {
  it("counts reconcile to total + bucket counts match", () => {
    const emails: ScannedEmail[] = [
      // Awaiting (no draft, b2b_sales requires approval)
      scanned({ envelope: envelope({ id: "a" }) }),
      // Handled (terminal approval)
      scanned({
        envelope: envelope({ id: "b" }),
        hasApproval: true,
        approvalId: "TERMINAL",
      }),
      // FYI only (customer_support, no draft)
      scanned({
        envelope: envelope({ id: "c" }),
        classification: {
          category: "customer_support",
          confidence: 0.9,
          reason: "x",
          ruleId: "x",
        },
      }),
      // Junk
      scanned({
        envelope: envelope({ id: "d" }),
        classification: {
          category: "junk_fyi",
          confidence: 0.9,
          reason: "x",
          ruleId: "x",
        },
      }),
    ];

    const rows = projectBacklogRows(emails, cfg, NOW);
    const s = summarizeBacklog(rows);

    expect(s.total).toBe(4);
    expect(s.awaitingDecision).toBe(1);
    expect(s.handled).toBe(1);
    expect(s.fyiOnly).toBe(1);
    expect(s.junk).toBe(1);
    // a + b are both b2b_sales (default scanned() classification).
    expect(s.byCategory.b2b_sales).toBe(2);
    expect(s.byCategory.customer_support).toBe(1);
    expect(s.byCategory.junk_fyi).toBe(1);
    // Awaiting + handled + fyi-only + junk should sum to total.
    expect(s.awaitingDecision + s.handled + s.fyiOnly + s.junk).toBe(s.total);
  });

  it("oldestAwaitingHours surfaces ONLY awaiting-decision rows", () => {
    // Old handled email (24h) — should NOT count toward oldestAwaiting.
    // Newer awaiting email (3h) — should count.
    const emails: ScannedEmail[] = [
      scanned({
        envelope: envelope({
          id: "old-handled",
          date: new Date(NOW.getTime() - 24 * 3600_000).toISOString(),
        }),
        hasApproval: true,
        approvalId: "TERMINAL",
      }),
      scanned({
        envelope: envelope({
          id: "new-awaiting",
          date: new Date(NOW.getTime() - 3 * 3600_000).toISOString(),
        }),
      }),
    ];
    const rows = projectBacklogRows(emails, cfg, NOW);
    const s = summarizeBacklog(rows);
    expect(s.oldestAwaitingHours).toBe(3);
  });

  it("oldestAwaitingHours is null when no rows are awaiting-decision", () => {
    const emails: ScannedEmail[] = [
      scanned({
        envelope: envelope({ id: "h" }),
        hasApproval: true,
        approvalId: "TERMINAL",
      }),
    ];
    const rows = projectBacklogRows(emails, cfg, NOW);
    expect(summarizeBacklog(rows).oldestAwaitingHours).toBe(null);
  });

  it("zero-len input returns no NaN", () => {
    const s = summarizeBacklog([]);
    expect(s.total).toBe(0);
    expect(s.awaitingDecision).toBe(0);
    expect(s.oldestAwaitingHours).toBe(null);
  });
});

describe("pickStaleAwaiting", () => {
  // Build rows with explicit ages + urgencies to exercise the predicate.
  function row(
    id: string,
    urgency: BacklogRow["urgency"],
    ageHours: number,
  ): BacklogRow {
    return {
      emailId: id,
      receivedAt: new Date(NOW.getTime() - ageHours * 3600_000).toISOString(),
      category: "b2b_sales",
      urgency,
      state: "awaiting-decision",
      hasDraft: false,
      hasApproval: false,
      approvalId: null,
      subject: id,
      from: "x@y.com",
      ageHours,
    };
  }

  it("only includes rows whose age exceeds STALE_HOURS_BY_URGENCY[urgency]", () => {
    const rows: BacklogRow[] = [
      row("crit-fresh", "critical", 0), // < 1h, fresh
      row("crit-stale", "critical", 2), // > 1h, stale
      row("high-fresh", "high", 3), // < 4h, fresh
      row("high-stale", "high", 5), // > 4h, stale
      row("low-fresh", "low", 12), // < 24h
    ];
    const stale = pickStaleAwaiting(rows);
    const ids = stale.map((r) => r.emailId);
    expect(ids).toContain("crit-stale");
    expect(ids).toContain("high-stale");
    expect(ids).not.toContain("crit-fresh");
    expect(ids).not.toContain("high-fresh");
    expect(ids).not.toContain("low-fresh");
  });

  it("sorts critical > high > medium > low; oldest first within tier", () => {
    const rows: BacklogRow[] = [
      row("h-old", "high", 20),
      row("c-young", "critical", 2),
      row("h-young", "high", 5),
      row("c-old", "critical", 10),
    ];
    const stale = pickStaleAwaiting(rows);
    expect(stale.map((r) => r.emailId)).toEqual([
      "c-old",
      "c-young",
      "h-old",
      "h-young",
    ]);
  });

  it("respects limit", () => {
    const rows: BacklogRow[] = [
      row("c1", "critical", 5),
      row("c2", "critical", 6),
      row("c3", "critical", 7),
    ];
    expect(pickStaleAwaiting(rows, { limit: 2 })).toHaveLength(2);
  });

  it("never includes non-awaiting-decision rows", () => {
    const handled: BacklogRow = { ...row("h", "critical", 100), state: "handled" };
    expect(pickStaleAwaiting([handled])).toEqual([]);
  });
});

describe("renderBacklogBriefLine", () => {
  it("zero awaiting → empty string (quiet collapse)", () => {
    const empty = renderBacklogBriefLine({
      total: 0,
      awaitingDecision: 0,
      handled: 0,
      fyiOnly: 0,
      junk: 0,
      stale: 0,
      oldestAwaitingHours: null,
      byCategory: {
        customer_support: 0,
        b2b_sales: 0,
        ap_finance: 0,
        vendor_supply: 0,
        sample_request: 0,
        shipping_issue: 0,
        receipt_document: 0,
        marketing_pr: 0,
        junk_fyi: 0,
      },
      byUrgency: { critical: 0, high: 0, medium: 0, low: 0 },
    });
    expect(empty).toBe("");
  });

  it("renders the canonical line with awaiting count + oldest age + stale tail", () => {
    const line = renderBacklogBriefLine({
      total: 5,
      awaitingDecision: 3,
      handled: 1,
      fyiOnly: 1,
      junk: 0,
      stale: 2,
      oldestAwaitingHours: 18,
      byCategory: {
        customer_support: 0,
        b2b_sales: 3,
        ap_finance: 0,
        vendor_supply: 0,
        sample_request: 0,
        shipping_issue: 0,
        receipt_document: 0,
        marketing_pr: 0,
        junk_fyi: 0,
      },
      byUrgency: { critical: 1, high: 1, medium: 1, low: 0 },
    });
    expect(line).toContain("Inbox triage");
    expect(line).toContain("3 awaiting decision");
    expect(line).toContain("18h ago");
    expect(line).toContain("2 stale");
  });

  it("omits the stale tail when zero stale", () => {
    const line = renderBacklogBriefLine({
      total: 3,
      awaitingDecision: 3,
      handled: 0,
      fyiOnly: 0,
      junk: 0,
      stale: 0,
      oldestAwaitingHours: 2,
      byCategory: {
        customer_support: 0,
        b2b_sales: 3,
        ap_finance: 0,
        vendor_supply: 0,
        sample_request: 0,
        shipping_issue: 0,
        receipt_document: 0,
        marketing_pr: 0,
        junk_fyi: 0,
      },
      byUrgency: { critical: 0, high: 0, medium: 3, low: 0 },
    });
    expect(line).toContain("3 awaiting");
    expect(line).not.toContain("stale");
  });
});

describe("STALE_HOURS_BY_URGENCY — sanity", () => {
  it("monotonic: critical < high < medium < low", () => {
    expect(STALE_HOURS_BY_URGENCY.critical).toBeLessThan(
      STALE_HOURS_BY_URGENCY.high,
    );
    expect(STALE_HOURS_BY_URGENCY.high).toBeLessThan(
      STALE_HOURS_BY_URGENCY.medium,
    );
    expect(STALE_HOURS_BY_URGENCY.medium).toBeLessThan(
      STALE_HOURS_BY_URGENCY.low,
    );
  });
});
