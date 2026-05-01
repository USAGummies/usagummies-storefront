/**
 * Phase 37.3 — HubSpot Verification tests.
 *
 * Coverage targets per /contracts/email-agents-system.md §2.9:
 *   - Whale-domain match short-circuits to hard-block BEFORE any HubSpot call.
 *   - UNQUALIFIED lead status hard-blocks the send (doctrine §7.8).
 *   - §11.6 hard gate: missing usa_vertical / usa_tier / usa_cadence_state
 *     surfaces as `verification_incomplete` (NOT hard-block — soft signal).
 *   - Missing contact surfaces as `verification_missing_contact`.
 *   - HubSpot 5xx / throw → `verification_degraded` with notes.
 *   - SKIPPED_CATEGORIES (Z spam / N/O/P bounces / _unclassified) skip the
 *     HubSpot call entirely.
 *   - HubSpot-not-configured wholesale-degrades the run without throwing.
 *   - Lookup cap fires correctly at maxLookups.
 *   - Records are persisted to inbox:scan:<msgId> with the hubspot metadata.
 *   - dryRun does not mutate KV.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  buildContactEnrichment,
  decideVerificationStatus,
  runHubSpotVerification,
  verifyRecord,
  type VerifiedRecord,
} from "../hubspot-verification";
import type { ClassifiedRecord } from "../classifier";
import type { ScanStatus } from "../inbox-scanner";

/**
 * Properties bag we pass into `buildContactEnrichment`. Distinct from
 * the enriched output shape — keep the test data flat HubSpot-API-shaped.
 */
type HsProps = Record<string, string | null>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function classified(
  partial: Partial<ClassifiedRecord> = {},
): ClassifiedRecord {
  return {
    messageId: "msg-1",
    threadId: "thr-1",
    fromEmail: "buyer@christmasmouse.com",
    fromHeader: "Buyer <buyer@christmasmouse.com>",
    subject: "Sample request",
    date: "Fri, 24 Apr 2026 12:00:00 -0700",
    snippet: "Send me a sample pack.",
    labelIds: ["INBOX"],
    status: "classified" as ScanStatus,
    noiseReason: "",
    observedAt: "2026-04-30T20:00:00.000Z",
    category: "A_sample_request",
    confidence: 0.88,
    ruleId: "legacy:sample-request",
    classificationReason: "Sample request keywords",
    classifiedAt: "2026-04-30T20:01:00.000Z",
    ...partial,
  };
}

interface FakeStore {
  data: Map<string, unknown>;
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<unknown>;
}

function fakeStore(): FakeStore {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(key: string): Promise<T | null> {
      return (data.get(key) as T) ?? null;
    },
    async set(key: string, value: unknown): Promise<unknown> {
      data.set(key, value);
      return value;
    },
  };
}

interface FakeHubSpot {
  contacts: Map<string, { id: string; properties: Record<string, string | null> }>;
  emailToId: Map<string, string>;
  configured: boolean;
  failFindForEmail?: string;
  failGetForId?: string;
  findCalls: number;
  getCalls: number;
  isConfigured(): boolean;
  findContactByEmail(email: string): Promise<string | null>;
  getContactById(
    id: string,
    properties?: readonly string[],
  ): Promise<{ id: string; properties: Record<string, string | null> } | null>;
}

function fakeHubSpot(
  contacts: Array<{
    id: string;
    email: string;
    properties: Record<string, string | null>;
  }>,
): FakeHubSpot {
  const contactsMap = new Map<
    string,
    { id: string; properties: Record<string, string | null> }
  >();
  const emailToId = new Map<string, string>();
  for (const c of contacts) {
    contactsMap.set(c.id, {
      id: c.id,
      properties: { email: c.email, ...c.properties },
    });
    emailToId.set(c.email.toLowerCase(), c.id);
  }
  return {
    contacts: contactsMap,
    emailToId,
    configured: true,
    findCalls: 0,
    getCalls: 0,
    isConfigured() {
      return this.configured;
    },
    async findContactByEmail(email: string) {
      this.findCalls += 1;
      if (this.failFindForEmail && email === this.failFindForEmail) {
        throw new Error("hubspot find failed (simulated)");
      }
      return this.emailToId.get(email.toLowerCase()) ?? null;
    },
    async getContactById(id: string) {
      this.getCalls += 1;
      if (this.failGetForId && id === this.failGetForId) {
        throw new Error("hubspot get failed (simulated)");
      }
      return this.contacts.get(id) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("hubspot-verification / buildContactEnrichment", () => {
  it("derives fullName + uppercases lead status + flags 11.6 gate complete", () => {
    const e = buildContactEnrichment("c-1", {
      email: "Buyer@Store.COM",
      firstname: "Sarah",
      lastname: "Chen",
      company: "Acme Stores",
      jobtitle: "Buyer",
      lifecyclestage: "lead",
      hs_lead_status: "open",
      usa_vertical: "souvenir_destination",
      usa_tier: "T2",
      usa_cadence_state: "touch_1_sent",
    });
    expect(e.email).toBe("buyer@store.com");
    expect(e.fullName).toBe("Sarah Chen");
    expect(e.leadStatus).toBe("OPEN");
    expect(e.hubspotGateComplete).toBe(true);
  });

  it("flags hubspotGateComplete=false when any §11.6 prop missing", () => {
    const e = buildContactEnrichment("c-2", {
      email: "buyer@store.com",
      firstname: "Sarah",
      usa_vertical: "souvenir_destination",
      usa_tier: "",
      usa_cadence_state: "not_started",
    });
    expect(e.hubspotGateComplete).toBe(false);
  });

  it("treats null/undefined properties as empty strings", () => {
    const e = buildContactEnrichment("c-3", {
      email: "b@x.com",
      firstname: null,
      lastname: null,
      hs_lead_status: null,
      usa_vertical: null,
      usa_tier: null,
      usa_cadence_state: null,
    });
    expect(e.fullName).toBe("");
    expect(e.leadStatus).toBe("");
    expect(e.hubspotGateComplete).toBe(false);
  });
});

describe("hubspot-verification / decideVerificationStatus", () => {
  const fullProps: HsProps = {
    email: "buyer@store.com",
    firstname: "Sarah",
    lastname: "Chen",
    hs_lead_status: "open",
    usa_vertical: "souvenir_destination",
    usa_tier: "T2",
    usa_cadence_state: "touch_1_sent",
  };
  const fullEnrichment = buildContactEnrichment("c-1", fullProps);

  it("whale-domain wins over everything (HARD BLOCK)", () => {
    const out = decideVerificationStatus(fullEnrichment, "buc-ees.com");
    expect(out.hardBlock).toBe(true);
    expect(out.status).toBe("verification_unqualified");
    expect(out.reason).toContain("Whale-class");
  });

  it("UNQUALIFIED lead status → HARD BLOCK", () => {
    const e = buildContactEnrichment("c-1", {
      ...fullProps,
      hs_lead_status: "UNQUALIFIED",
    });
    const out = decideVerificationStatus(e, "");
    expect(out.hardBlock).toBe(true);
    expect(out.status).toBe("verification_unqualified");
  });

  it("missing contact → soft missing-contact (NOT hard-block)", () => {
    const out = decideVerificationStatus(null, "");
    expect(out.hardBlock).toBe(false);
    expect(out.status).toBe("verification_missing_contact");
  });

  it("contact present but §11.6 incomplete → incomplete (soft)", () => {
    const e = buildContactEnrichment("c-1", {
      ...fullProps,
      usa_vertical: "",
    });
    const out = decideVerificationStatus(e, "");
    expect(out.hardBlock).toBe(false);
    expect(out.status).toBe("verification_incomplete");
    expect(out.reason).toContain("usa_vertical");
  });

  it("complete contact + non-UNQUALIFIED lead status → verified", () => {
    const out = decideVerificationStatus(fullEnrichment, "");
    expect(out.hardBlock).toBe(false);
    expect(out.status).toBe("verified");
  });
});

// ---------------------------------------------------------------------------
// Per-record verifyRecord
// ---------------------------------------------------------------------------

describe("hubspot-verification / verifyRecord skip lanes", () => {
  it("skips records in SKIPPED_CATEGORIES (no HubSpot call)", async () => {
    const hs = fakeHubSpot([]);
    const r = classified({ category: "Z_obvious_spam" });
    const meta = await verifyRecord(r, {
      findContactByEmail: hs.findContactByEmail.bind(hs),
      getContactById: hs.getContactById.bind(hs),
      nowEpochMs: Date.UTC(2026, 4, 1),
    });
    expect(meta.status).toBe("verification_skipped");
    expect(hs.findCalls).toBe(0);
  });

  it("skips records with empty fromEmail", async () => {
    const hs = fakeHubSpot([]);
    const r = classified({ fromEmail: "" });
    const meta = await verifyRecord(r, {
      findContactByEmail: hs.findContactByEmail.bind(hs),
      getContactById: hs.getContactById.bind(hs),
      nowEpochMs: Date.UTC(2026, 4, 1),
    });
    expect(meta.status).toBe("verification_skipped");
    expect(hs.findCalls).toBe(0);
  });

  it("skips bounce categories N/O/P", async () => {
    const hs = fakeHubSpot([]);
    for (const cat of ["N_hard_bounce", "O_group_restricted", "P_soft_bounce"] as const) {
      const meta = await verifyRecord(
        classified({ category: cat }),
        {
          findContactByEmail: hs.findContactByEmail.bind(hs),
          getContactById: hs.getContactById.bind(hs),
          nowEpochMs: Date.UTC(2026, 4, 1),
        },
      );
      expect(meta.status).toBe("verification_skipped");
    }
    expect(hs.findCalls).toBe(0);
  });
});

describe("hubspot-verification / verifyRecord whale short-circuit", () => {
  it("whale match HARD BLOCKS before any HubSpot call", async () => {
    const hs = fakeHubSpot([
      {
        id: "c-whale",
        email: "charmaine@buc-ees.com",
        properties: {
          firstname: "Charmaine",
          hs_lead_status: "open",
          usa_vertical: "wholesale_marketplace",
          usa_tier: "T0",
          usa_cadence_state: "paused_hold_class",
        },
      },
    ]);
    const r = classified({
      fromEmail: "charmaine@buc-ees.com",
      fromHeader: "Charmaine <charmaine@buc-ees.com>",
      category: "S_whale_class",
    });
    const meta = await verifyRecord(r, {
      findContactByEmail: hs.findContactByEmail.bind(hs),
      getContactById: hs.getContactById.bind(hs),
      nowEpochMs: Date.UTC(2026, 4, 1),
    });
    expect(meta.hardBlock).toBe(true);
    expect(meta.status).toBe("verification_unqualified");
    expect(meta.whaleDomainMatch).toBe("buc-ees.com");
    expect(hs.findCalls).toBe(0);
    expect(hs.getCalls).toBe(0);
  });
});

describe("hubspot-verification / verifyRecord HubSpot lookups", () => {
  it("verified path: existing contact, complete §11.6 fields, non-UNQUALIFIED", async () => {
    const hs = fakeHubSpot([
      {
        id: "c-1",
        email: "buyer@christmasmouse.com",
        properties: {
          firstname: "Rob",
          lastname: "Smith",
          company: "Christmas Mouse",
          jobtitle: "Buyer",
          lifecyclestage: "opportunity",
          hs_lead_status: "open",
          usa_vertical: "souvenir_destination",
          usa_tier: "T2",
          usa_cadence_state: "touch_1_sent",
        },
      },
    ]);
    const meta = await verifyRecord(classified(), {
      findContactByEmail: hs.findContactByEmail.bind(hs),
      getContactById: hs.getContactById.bind(hs),
      nowEpochMs: Date.UTC(2026, 4, 1),
    });
    expect(meta.status).toBe("verified");
    expect(meta.hardBlock).toBe(false);
    expect(meta.contact?.fullName).toBe("Rob Smith");
    expect(meta.contact?.hubspotGateComplete).toBe(true);
  });

  it("UNQUALIFIED contact → HARD BLOCK", async () => {
    const hs = fakeHubSpot([
      {
        id: "c-1",
        email: "buyer@christmasmouse.com",
        properties: {
          firstname: "Rob",
          hs_lead_status: "UNQUALIFIED",
          usa_vertical: "souvenir_destination",
          usa_tier: "T2",
          usa_cadence_state: "closed_unqualified",
        },
      },
    ]);
    const meta = await verifyRecord(classified(), {
      findContactByEmail: hs.findContactByEmail.bind(hs),
      getContactById: hs.getContactById.bind(hs),
      nowEpochMs: Date.UTC(2026, 4, 1),
    });
    expect(meta.status).toBe("verification_unqualified");
    expect(meta.hardBlock).toBe(true);
  });

  it("contact found but §11.6 fields incomplete → soft incomplete", async () => {
    const hs = fakeHubSpot([
      {
        id: "c-1",
        email: "buyer@christmasmouse.com",
        properties: {
          firstname: "Rob",
          hs_lead_status: "open",
          usa_vertical: "souvenir_destination",
          // usa_tier missing
          usa_cadence_state: "touch_1_sent",
        },
      },
    ]);
    const meta = await verifyRecord(classified(), {
      findContactByEmail: hs.findContactByEmail.bind(hs),
      getContactById: hs.getContactById.bind(hs),
      nowEpochMs: Date.UTC(2026, 4, 1),
    });
    expect(meta.status).toBe("verification_incomplete");
    expect(meta.hardBlock).toBe(false);
    expect(meta.reason).toContain("usa_tier");
  });

  it("missing contact → soft missing-contact", async () => {
    const hs = fakeHubSpot([]); // no contacts in HubSpot
    const meta = await verifyRecord(classified(), {
      findContactByEmail: hs.findContactByEmail.bind(hs),
      getContactById: hs.getContactById.bind(hs),
      nowEpochMs: Date.UTC(2026, 4, 1),
    });
    expect(meta.status).toBe("verification_missing_contact");
    expect(meta.hardBlock).toBe(false);
  });

  it("findContactByEmail throws → degraded with notes", async () => {
    const hs = fakeHubSpot([]);
    hs.failFindForEmail = "buyer@christmasmouse.com";
    const meta = await verifyRecord(classified(), {
      findContactByEmail: hs.findContactByEmail.bind(hs),
      getContactById: hs.getContactById.bind(hs),
      nowEpochMs: Date.UTC(2026, 4, 1),
    });
    expect(meta.status).toBe("verification_degraded");
    expect(meta.notes.some((n) => n.includes("findContactByEmail"))).toBe(true);
  });

  it("getContactById throws → degraded with notes", async () => {
    const hs = fakeHubSpot([
      {
        id: "c-1",
        email: "buyer@christmasmouse.com",
        properties: { firstname: "Rob" },
      },
    ]);
    hs.failGetForId = "c-1";
    const meta = await verifyRecord(classified(), {
      findContactByEmail: hs.findContactByEmail.bind(hs),
      getContactById: hs.getContactById.bind(hs),
      nowEpochMs: Date.UTC(2026, 4, 1),
    });
    expect(meta.status).toBe("verification_degraded");
    expect(meta.notes.some((n) => n.includes("getContactById"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Batch runHubSpotVerification
// ---------------------------------------------------------------------------

describe("hubspot-verification / runHubSpotVerification", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = fakeStore();
  });

  it("persists every verified record under inbox:scan:<msgId>", async () => {
    const hs = fakeHubSpot([
      {
        id: "c-1",
        email: "buyer@christmasmouse.com",
        properties: {
          firstname: "Rob",
          hs_lead_status: "open",
          usa_vertical: "souvenir_destination",
          usa_tier: "T2",
          usa_cadence_state: "touch_1_sent",
        },
      },
    ]);
    const records = [
      classified({ messageId: "msg-001" }),
      classified({
        messageId: "msg-002",
        fromEmail: "charmaine@buc-ees.com",
        fromHeader: "Charmaine <charmaine@buc-ees.com>",
        category: "S_whale_class",
      }),
    ];

    const report = await runHubSpotVerification({
      records,
      store,
      hubspotLookups: {
        findContactByEmail: hs.findContactByEmail.bind(hs),
        getContactById: hs.getContactById.bind(hs),
        isConfigured: () => true,
      },
    });

    expect(report.examined).toBe(2);
    expect(report.verified).toBe(1);
    expect(report.hardBlocked).toBe(1);
    expect(report.hubspotLookups).toBe(1); // whale path skipped HS

    const persisted1 = store.data.get(
      "inbox:scan:msg-001",
    ) as VerifiedRecord;
    expect(persisted1.hubspot.status).toBe("verified");
    expect(persisted1.hubspot.contact?.fullName).toBe("Rob");

    const persisted2 = store.data.get(
      "inbox:scan:msg-002",
    ) as VerifiedRecord;
    expect(persisted2.hubspot.hardBlock).toBe(true);
    expect(persisted2.hubspot.whaleDomainMatch).toBe("buc-ees.com");
  });

  it("dryRun does not mutate KV", async () => {
    const hs = fakeHubSpot([]);
    const report = await runHubSpotVerification({
      records: [classified()],
      store,
      dryRun: true,
      hubspotLookups: {
        findContactByEmail: hs.findContactByEmail.bind(hs),
        getContactById: hs.getContactById.bind(hs),
        isConfigured: () => true,
      },
    });
    expect(report.examined).toBe(1);
    expect(store.data.size).toBe(0);
  });

  it("HubSpot not configured → wholesale-degrade (no throws, no lookups)", async () => {
    const hs = fakeHubSpot([]);
    const report = await runHubSpotVerification({
      records: [classified(), classified({ messageId: "msg-002" })],
      store,
      hubspotLookups: {
        findContactByEmail: hs.findContactByEmail.bind(hs),
        getContactById: hs.getContactById.bind(hs),
        isConfigured: () => false,
      },
    });
    expect(report.degraded).toBe(2);
    expect(hs.findCalls).toBe(0);
    expect(report.degradedNotes[0]).toContain("HubSpot not configured");
    expect(report.verifiedRecords).toHaveLength(2);
    for (const r of report.verifiedRecords) {
      expect(r.hubspot.status).toBe("verification_degraded");
    }
  });

  it("respects maxLookups cap and reports overage as degraded", async () => {
    const contacts = Array.from({ length: 5 }, (_, i) => ({
      id: `c-${i}`,
      email: `buyer${i}@store.com`,
      properties: {
        firstname: `B${i}`,
        hs_lead_status: "open",
        usa_vertical: "souvenir_destination",
        usa_tier: "T2",
        usa_cadence_state: "touch_1_sent",
      },
    }));
    const hs = fakeHubSpot(contacts);
    const records = contacts.map((c, i) =>
      classified({ messageId: `msg-${i}`, fromEmail: c.email, fromHeader: c.email }),
    );

    const report = await runHubSpotVerification({
      records,
      store,
      maxLookups: 2,
      hubspotLookups: {
        findContactByEmail: hs.findContactByEmail.bind(hs),
        getContactById: hs.getContactById.bind(hs),
        isConfigured: () => true,
      },
    });

    expect(report.examined).toBe(5);
    expect(report.hubspotLookups).toBe(2);
    expect(report.degraded).toBe(3); // overflow rows
    expect(report.verified).toBe(2);
  });

  it("counts each outcome bucket cleanly", async () => {
    const hs = fakeHubSpot([
      {
        id: "c-verified",
        email: "good@store.com",
        properties: {
          firstname: "Good",
          hs_lead_status: "open",
          usa_vertical: "souvenir_destination",
          usa_tier: "T2",
          usa_cadence_state: "touch_1_sent",
        },
      },
      {
        id: "c-incomplete",
        email: "incomplete@store.com",
        properties: {
          firstname: "Inc",
          hs_lead_status: "open",
          // missing all 11.6 props
        },
      },
      {
        id: "c-unqualified",
        email: "uq@store.com",
        properties: {
          firstname: "UQ",
          hs_lead_status: "UNQUALIFIED",
          usa_vertical: "souvenir_destination",
          usa_tier: "T2",
          usa_cadence_state: "closed_unqualified",
        },
      },
    ]);

    const records: ClassifiedRecord[] = [
      classified({ messageId: "m1", fromEmail: "good@store.com", fromHeader: "good@store.com" }),
      classified({ messageId: "m2", fromEmail: "incomplete@store.com", fromHeader: "incomplete@store.com" }),
      classified({ messageId: "m3", fromEmail: "uq@store.com", fromHeader: "uq@store.com" }),
      classified({
        messageId: "m4",
        fromEmail: "missing@store.com",
        fromHeader: "missing@store.com",
      }),
      classified({ messageId: "m5", category: "Z_obvious_spam" }),
    ];

    const report = await runHubSpotVerification({
      records,
      store,
      hubspotLookups: {
        findContactByEmail: hs.findContactByEmail.bind(hs),
        getContactById: hs.getContactById.bind(hs),
        isConfigured: () => true,
      },
    });

    expect(report.verified).toBe(1);
    expect(report.incomplete).toBe(1);
    expect(report.hardBlocked).toBe(1);
    expect(report.missingContact).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.examined).toBe(5);
  });
});
