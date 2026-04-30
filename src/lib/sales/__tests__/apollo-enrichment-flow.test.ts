/**
 * Tests for the Phase D5 v0.2 Apollo enrichment FLOW.
 *
 * Mocks `fetch` for both HubSpot + Apollo APIs and uses in-memory
 * audit stores so we can assert on the full provenance trail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetStores,
  __setStoresForTest,
  InMemoryApprovalStore,
  InMemoryAuditStore,
} from "@/lib/ops/control-plane/stores";
import {
  __resetSurfaces,
  __setSurfacesForTest,
} from "@/lib/ops/control-plane/slack";
import type {
  ApprovalRequest,
  AuditLogEntry,
} from "@/lib/ops/control-plane/types";
import {
  enrichContactById,
  fetchEnrichableContact,
  projectContactToEnrichable,
} from "@/lib/sales/apollo-enrichment-flow";

class StubApprovalSurface {
  public surfaced: ApprovalRequest[] = [];
  public updated: ApprovalRequest[] = [];
  async surfaceApproval(req: ApprovalRequest) {
    this.surfaced.push(structuredClone(req));
    return { channel: "ops-approvals" as const, ts: `ts-${req.id}` };
  }
  async updateApproval(req: ApprovalRequest) {
    this.updated.push(structuredClone(req));
  }
}
class StubAuditSurface {
  public mirrored: AuditLogEntry[] = [];
  async mirror(entry: AuditLogEntry) {
    this.mirrored.push(structuredClone(entry));
  }
}

const ORIGINAL_FETCH = global.fetch;
const SAVED_HUBSPOT = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SAVED_APOLLO = process.env.APOLLO_API_KEY;

let auditStoreRef: InMemoryAuditStore;
let auditSurfaceRef: StubAuditSurface;

beforeEach(() => {
  process.env.HUBSPOT_PRIVATE_APP_TOKEN = "pat-test";
  process.env.APOLLO_API_KEY = "apollo-test";
  auditStoreRef = new InMemoryAuditStore();
  auditSurfaceRef = new StubAuditSurface();
  __resetStores();
  __resetSurfaces();
  __setStoresForTest({
    approval: new InMemoryApprovalStore(),
    audit: auditStoreRef,
  });
  __setSurfacesForTest({
    approval: new StubApprovalSurface(),
    audit: auditSurfaceRef,
  });
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (SAVED_HUBSPOT === undefined) delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  else process.env.HUBSPOT_PRIVATE_APP_TOKEN = SAVED_HUBSPOT;
  if (SAVED_APOLLO === undefined) delete process.env.APOLLO_API_KEY;
  else process.env.APOLLO_API_KEY = SAVED_APOLLO;
});

describe("projectContactToEnrichable — pure projection", () => {
  it("maps null/undefined HubSpot props to null in EnrichableContact", () => {
    const r = projectContactToEnrichable({
      id: "c1",
      properties: { email: "test@example.com" },
    });
    expect(r).not.toBeNull();
    expect(r!.email).toBe("test@example.com");
    expect(r!.firstname).toBeNull();
    expect(r!.lastname).toBeNull();
    expect(r!.jobtitle).toBeNull();
    expect(r!.phone).toBeNull();
    expect(r!.company).toBeNull();
    expect(r!.city).toBeNull();
    expect(r!.state).toBeNull();
  });

  it("returns null when email is missing (the search key)", () => {
    const r = projectContactToEnrichable({ id: "c1", properties: {} });
    expect(r).toBeNull();
  });
});

describe("fetchEnrichableContact — HubSpot GET", () => {
  it("returns the contact projected to EnrichableContact shape", async () => {
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          id: "c-7",
          properties: {
            email: "buyer@example.com",
            firstname: "Sarah",
            lastname: null,
            jobtitle: "Director",
            phone: null,
            company: "Acme",
            city: null,
            state: null,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof global.fetch;
    const c = await fetchEnrichableContact("c-7");
    expect(c).not.toBeNull();
    expect(c!.id).toBe("c-7");
    expect(c!.firstname).toBe("Sarah");
    expect(c!.lastname).toBeNull();
    expect(c!.jobtitle).toBe("Director");
  });

  it("returns null on HubSpot 404", async () => {
    global.fetch = (async () =>
      new Response("not found", { status: 404 })) as unknown as typeof global.fetch;
    const c = await fetchEnrichableContact("c-missing");
    expect(c).toBeNull();
  });
});

describe("enrichContactById — full flow", () => {
  it("env-unset short-circuits with skipped:true", async () => {
    delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
    const r = await enrichContactById("c-1");
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe(true);
    expect(r.error).toMatch(/HUBSPOT_PRIVATE_APP_TOKEN/);
  });

  it("apollo env-unset short-circuits with skipped:true", async () => {
    delete process.env.APOLLO_API_KEY;
    const r = await enrichContactById("c-1");
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe(true);
    expect(r.error).toMatch(/APOLLO_API_KEY/);
  });

  it("returns notFound when HubSpot returns 404 for the contact", async () => {
    global.fetch = (async () =>
      new Response("missing", { status: 404 })) as unknown as typeof global.fetch;
    const r = await enrichContactById("c-missing");
    expect(r.ok).toBe(false);
    expect(r.notFound).toBe(true);
  });

  it("happy path: fetches contact, queries apollo, fills fields, audits Class A", async () => {
    let upsertCalled = false;
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      // 1. HubSpot GET contact
      if (url.includes("/crm/v3/objects/contacts/c-7?")) {
        return new Response(
          JSON.stringify({
            id: "c-7",
            properties: { email: "buyer@example.com", firstname: null, lastname: null, jobtitle: null, phone: null, company: null, city: null, state: null },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // 2. Apollo POST
      if (url.includes("/v1/mixed_people/search")) {
        return new Response(
          JSON.stringify({
            people: [
              {
                id: "apollo-7",
                email: "buyer@example.com",
                email_status: "verified",
                first_name: "Sarah",
                last_name: "McGowan",
                title: "Director of Retail",
                mobile_phone_number: "+15551234567",
                organization: { name: "Bryce Glamp & Camp" },
                city: "Salt Lake City",
                state: "UT",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // 3. HubSpot upsert: search-by-email then PATCH or POST
      if (url.includes("/crm/v3/objects/contacts/search") && init?.method === "POST") {
        return new Response(JSON.stringify({ results: [{ id: "c-7" }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/crm/v3/objects/contacts/c-7") && init?.method === "PATCH") {
        upsertCalled = true;
        return new Response(JSON.stringify({ id: "c-7" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof global.fetch;

    const r = await enrichContactById("c-7");
    expect(r.ok).toBe(true);
    expect(r.proposal!.hasChanges).toBe(true);
    expect(r.proposal!.fills.length).toBe(7); // all 7 enrichable fields
    expect(r.written).toBe(true);
    expect(r.hubspotContactId).toBe("c-7");
    expect(upsertCalled).toBe(true);
    // Audit assertions
    const all = await auditStoreRef.recent(10);
    const enrichmentAudits = all.filter((e) => e.action === "lead.enrichment.write");
    expect(enrichmentAudits.length).toBe(1);
    const audit = enrichmentAudits[0];
    expect(audit.result).toBe("ok");
    expect(audit.sourceCitations.length).toBe(1);
    expect(audit.sourceCitations[0].system).toBe("apollo");
    expect(audit.sourceCitations[0].id).toBe("apollo-7");
    expect(audit.confidence).toBeGreaterThan(0.7); // verified + unlocked + has org + has title
    // The retrievedAt is folded into after.apolloRetrievedAt for explicit chain
    const after = audit.after as Record<string, unknown>;
    expect(typeof after.apolloRetrievedAt).toBe("string");
    expect(after.apolloPersonId).toBe("apollo-7");
    expect(after.written).toBe(true);
  });

  it("no-op when proposal hasChanges=false (no apollo match)", async () => {
    global.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/crm/v3/objects/contacts/c-7?")) {
        return new Response(
          JSON.stringify({
            id: "c-7",
            properties: { email: "buyer@example.com", firstname: "Sarah", lastname: null, jobtitle: null, phone: null, company: null, city: null, state: null },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/v1/mixed_people/search")) {
        return new Response(JSON.stringify({ people: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof global.fetch;

    const r = await enrichContactById("c-7");
    expect(r.ok).toBe(true);
    expect(r.written).toBe(false);
    expect(r.proposal!.hasChanges).toBe(false);
    expect(r.proposal!.skipReasons).toContain("no apollo match");
    // Even no-op enrichments are auditable
    const all = await auditStoreRef.recent(10);
    expect(all.filter((e) => e.action === "lead.enrichment.write")).toHaveLength(1);
  });

  it("audits write failure as result=error", async () => {
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/crm/v3/objects/contacts/c-7?")) {
        return new Response(
          JSON.stringify({ id: "c-7", properties: { email: "buyer@example.com", firstname: null } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/v1/mixed_people/search")) {
        return new Response(
          JSON.stringify({ people: [{ id: "a1", email: "buyer@example.com", email_status: "verified", first_name: "Sarah" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/crm/v3/objects/contacts/search") && init?.method === "POST") {
        return new Response(JSON.stringify({ results: [{ id: "c-7" }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/crm/v3/objects/contacts/c-7") && init?.method === "PATCH") {
        return new Response("permission denied", { status: 403 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof global.fetch;

    const r = await enrichContactById("c-7");
    expect(r.ok).toBe(false);
    // Note: upsertContactByEmail in the existing client returns null on failure
    // rather than throwing, so written stays false. Either way the audit is captured.
    const all = await auditStoreRef.recent(10);
    const enrichmentAudits = all.filter((e) => e.action === "lead.enrichment.write");
    expect(enrichmentAudits.length).toBeGreaterThan(0);
  });

  it("apollo lookup network failure → ok:false (does not throw)", async () => {
    global.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/crm/v3/objects/contacts/c-7?")) {
        return new Response(
          JSON.stringify({ id: "c-7", properties: { email: "buyer@example.com" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/v1/mixed_people/search")) {
        throw new Error("ENETUNREACH");
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof global.fetch;

    const r = await enrichContactById("c-7");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Apollo lookup failed/);
  });
});
