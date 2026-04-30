/**
 * Tests for the Sales-tour v0.3 HubSpot autosync helper.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BoothVisitIntent } from "@/lib/sales-tour/booth-visit-types";
import { composeBoothQuote } from "@/lib/sales-tour/compose-booth-quote";
import {
  autosyncBoothQuoteToHubSpot,
  dealnameForQuote,
  stageForQuote,
} from "@/lib/sales-tour/hubspot-autosync";
import { HUBSPOT } from "@/lib/ops/hubspot-client";

const ORIGINAL_FETCH = global.fetch;
const SAVED_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;

const FIXED_NOW = new Date("2026-05-11T15:30:00.000Z");

function intent(overrides: Partial<BoothVisitIntent> = {}): BoothVisitIntent {
  return {
    rawText: "test",
    prospectName: "Bryce Glamp and Camp",
    state: "UT",
    city: null,
    scale: "master-carton",
    count: 1,
    totalBags: 36,
    freightAsk: "landed",
    contactName: "Sarah",
    contactPhone: "5555551212",
    contactEmail: "sarah@brycecamp.com",
    notes: null,
    confidence: 0.9,
    ...overrides,
  };
}

beforeEach(() => {
  delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (SAVED_TOKEN === undefined) delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  else process.env.HUBSPOT_PRIVATE_APP_TOKEN = SAVED_TOKEN;
});

describe("dealnameForQuote", () => {
  it("formats as '<prospect> — Booth quote (May 11–17 trip)' for the may-2026 trip", () => {
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    expect(dealnameForQuote(q)).toBe("Bryce Glamp and Camp — Booth quote (May 11–17 trip)");
  });

  it("falls back to '(unknown prospect)' when no prospect name", () => {
    const q = composeBoothQuote(intent({ prospectName: null }), { now: FIXED_NOW });
    expect(dealnameForQuote(q)).toContain("(unknown prospect)");
  });

  it("uses raw tourId for non-may-2026 trips", () => {
    const q = composeBoothQuote(intent(), { now: FIXED_NOW, tourId: "fall-2026" });
    expect(dealnameForQuote(q)).toContain("fall-2026");
  });
});

describe("stageForQuote", () => {
  it("maps Class A grid quote → STAGE_QUOTE_PO_SENT", () => {
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    expect(q.approval).toBe("none");
    expect(q.dealCheckRequired).toBe(false);
    expect(stageForQuote(q)).toBe(HUBSPOT.STAGE_QUOTE_PO_SENT);
  });

  it("maps Class C non-grid quote → STAGE_LEAD", () => {
    const q = composeBoothQuote(
      intent({ scale: "pallet", count: 3, totalBags: 2700, freightAsk: "anchor" }),
      { now: FIXED_NOW },
    );
    expect(q.approval).toBe("class-c");
    expect(q.dealCheckRequired).toBe(true);
    expect(stageForQuote(q)).toBe(HUBSPOT.STAGE_LEAD);
  });
});

describe("autosyncBoothQuoteToHubSpot", () => {
  it("returns ok:false skipped:true when HUBSPOT_PRIVATE_APP_TOKEN is unset", async () => {
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const r = await autosyncBoothQuoteToHubSpot(q);
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe(true);
    expect(r.error).toMatch(/HUBSPOT_PRIVATE_APP_TOKEN/);
  });

  it("creates a deal with prospect-named title + populated description + on-grid stage", async () => {
    process.env.HUBSPOT_PRIVATE_APP_TOKEN = "pat-test";
    let dealCreatePayload: Record<string, unknown> | null = null;
    let contactSearchHitFirst = true;
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      // Contact upsert flow: search → (no hit) → create
      if (url.includes("/crm/v3/objects/contacts/search")) {
        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/crm/v3/objects/contacts") && init?.method === "POST") {
        contactSearchHitFirst = false;
        return new Response(JSON.stringify({ id: "contact-7" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/crm/v3/objects/deals") && init?.method === "POST") {
        dealCreatePayload = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ id: "deal-42" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof global.fetch;
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const r = await autosyncBoothQuoteToHubSpot(q);
    expect(r.ok).toBe(true);
    expect(r.dealId).toBe("deal-42");
    expect(r.contactId).toBe("contact-7");
    expect(r.dealStage).toBe(HUBSPOT.STAGE_QUOTE_PO_SENT);
    expect(contactSearchHitFirst).toBe(false);
    expect(dealCreatePayload).not.toBeNull();
    const props = (dealCreatePayload as unknown as { properties: Record<string, string> }).properties;
    expect(props.dealname).toContain("Bryce Glamp and Camp");
    expect(props.amount).toBe("125.64"); // 36 * 3.49
    expect(props.dealstage).toBe(HUBSPOT.STAGE_QUOTE_PO_SENT);
  });

  it("creates a deal at STAGE_LEAD when deal-check is required", async () => {
    process.env.HUBSPOT_PRIVATE_APP_TOKEN = "pat-test";
    let dealCreatePayload: Record<string, unknown> | null = null;
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/crm/v3/objects/contacts/search")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/crm/v3/objects/contacts") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "c1" }), { status: 201, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/crm/v3/objects/deals") && init?.method === "POST") {
        dealCreatePayload = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ id: "d1" }), { status: 201, headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof global.fetch;
    const q = composeBoothQuote(
      intent({ scale: "pallet", count: 3, totalBags: 2700, freightAsk: "anchor" }),
      { now: FIXED_NOW },
    );
    const r = await autosyncBoothQuoteToHubSpot(q);
    expect(r.ok).toBe(true);
    expect(r.dealStage).toBe(HUBSPOT.STAGE_LEAD);
    const props = (dealCreatePayload as unknown as { properties: Record<string, string> }).properties;
    expect(props.dealstage).toBe(HUBSPOT.STAGE_LEAD);
    expect(props.description).toContain("Deal-check required");
  });

  it("continues without contactId when buyer email is missing", async () => {
    process.env.HUBSPOT_PRIVATE_APP_TOKEN = "pat-test";
    let dealCreated = false;
    global.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/crm/v3/objects/deals")) {
        dealCreated = true;
        return new Response(JSON.stringify({ id: "d1" }), { status: 201, headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof global.fetch;
    const q = composeBoothQuote(intent({ contactEmail: null }), { now: FIXED_NOW });
    const r = await autosyncBoothQuoteToHubSpot(q);
    expect(r.ok).toBe(true);
    expect(r.contactId).toBeUndefined();
    expect(dealCreated).toBe(true);
  });

  it("returns ok:false when deal create fails", async () => {
    process.env.HUBSPOT_PRIVATE_APP_TOKEN = "pat-test";
    global.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/crm/v3/objects/contacts/search")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/crm/v3/objects/contacts")) {
        return new Response(JSON.stringify({ id: "c1" }), { status: 201, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/crm/v3/objects/deals")) {
        return new Response("permission denied", { status: 403 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof global.fetch;
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const r = await autosyncBoothQuoteToHubSpot(q);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/createDeal returned null/);
  });

  it("survives contact upsert failure (fail-soft) and still creates the deal", async () => {
    process.env.HUBSPOT_PRIVATE_APP_TOKEN = "pat-test";
    global.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/crm/v3/objects/contacts/search")) {
        return new Response("error", { status: 500 });
      }
      if (url.endsWith("/crm/v3/objects/contacts")) {
        return new Response("error", { status: 500 });
      }
      if (url.endsWith("/crm/v3/objects/deals")) {
        return new Response(JSON.stringify({ id: "d1" }), { status: 201, headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof global.fetch;
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const r = await autosyncBoothQuoteToHubSpot(q);
    expect(r.ok).toBe(true);
    expect(r.dealId).toBe("d1");
    expect(r.contactId).toBeUndefined();
  });
});
