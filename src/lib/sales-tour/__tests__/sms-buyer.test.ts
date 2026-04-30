/**
 * Tests for the Sales-tour v0.3 buyer-SMS helper.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BoothVisitIntent } from "@/lib/sales-tour/booth-visit-types";
import { composeBoothQuote } from "@/lib/sales-tour/compose-booth-quote";
import {
  buildNcsDeepLink,
  composeBuyerSmsBody,
  smsBuyerNcsLink,
} from "@/lib/sales-tour/sms-buyer";

const ORIGINAL_FETCH = global.fetch;
const ENV_KEYS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "SALES_TOUR_BUYER_SMS_ENABLED",
];
const SAVED_ENV: Record<string, string | undefined> = {};

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
    contactEmail: null,
    notes: null,
    confidence: 0.9,
    ...overrides,
  };
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    SAVED_ENV[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  for (const k of ENV_KEYS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
});

describe("buildNcsDeepLink", () => {
  it("builds /upload/ncs?co=<company>&ref=<tour-visit>", () => {
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const link = buildNcsDeepLink(q);
    expect(link).toContain("https://www.usagummies.com/upload/ncs?");
    expect(link).toContain("co=Bryce+Glamp+and+Camp");
    expect(link).toContain(`ref=${encodeURIComponent(`${q.tourId}-${q.visitId}`)}`);
  });

  it("URL-encodes special chars in company name", () => {
    const q = composeBoothQuote(
      intent({ prospectName: "Bryce Glamp & Camp / The Cabin" }),
      { now: FIXED_NOW },
    );
    const link = buildNcsDeepLink(q);
    expect(link).toContain("co=Bryce+Glamp+%26+Camp+%2F+The+Cabin");
  });

  it("falls back to no co= param when prospect name is null", () => {
    const q = composeBoothQuote(intent({ prospectName: null }), { now: FIXED_NOW });
    const link = buildNcsDeepLink(q);
    expect(link).not.toContain("co=");
    expect(link).toContain("ref=");
  });
});

describe("composeBuyerSmsBody", () => {
  it("includes opening, quote line, NCS link, opt-out", () => {
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const body = composeBuyerSmsBody(q);
    expect(body).toContain("USA Gummies");
    expect(body).toContain("36 bags @ $3.49/bag");
    expect(body).toContain("usagummies.com/upload/ncs");
    expect(body).toContain("Reply STOP to opt out");
  });

  it("does NOT name Ben's full name (CLAUDE.md public-copy rule)", () => {
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const body = composeBuyerSmsBody(q);
    expect(body).not.toContain("Ben Stutman");
    expect(body).not.toContain("Benjamin Stutman");
  });

  it("does NOT name the warehouse city (CLAUDE.md public-copy rule)", () => {
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const body = composeBuyerSmsBody(q);
    expect(body.toLowerCase()).not.toContain("ashford");
  });

  it("omits dollar amount in line summary when totalUsd is 0 (sample drop)", () => {
    const q = composeBoothQuote(
      intent({ scale: "sample", count: 1, totalBags: 1 }),
      { now: FIXED_NOW },
    );
    const body = composeBuyerSmsBody(q);
    expect(body).toContain("1 bags @ $0.00/bag");
    expect(body).not.toMatch(/\$0(?!\.\d{2})/); // No bare "$0" total
  });
});

describe("smsBuyerNcsLink", () => {
  it("returns ok:false skipped:true when SALES_TOUR_BUYER_SMS_ENABLED is unset", async () => {
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const r = await smsBuyerNcsLink(q);
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe(true);
    expect(r.error).toMatch(/SALES_TOUR_BUYER_SMS_ENABLED/);
  });

  it("returns ok:false skipped:true when Twilio env partial", async () => {
    process.env.SALES_TOUR_BUYER_SMS_ENABLED = "true";
    process.env.TWILIO_ACCOUNT_SID = "AC1234";
    // Missing TOKEN + FROM
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const r = await smsBuyerNcsLink(q);
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe(true);
    expect(r.error).toMatch(/Twilio env/);
  });

  it("returns missingBuyerPhone when intent has no contactPhone", async () => {
    process.env.SALES_TOUR_BUYER_SMS_ENABLED = "true";
    process.env.TWILIO_ACCOUNT_SID = "AC1234";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_FROM_NUMBER = "+15551111111";
    const q = composeBoothQuote(intent({ contactPhone: null }), { now: FIXED_NOW });
    const r = await smsBuyerNcsLink(q);
    expect(r.ok).toBe(false);
    expect(r.missingBuyerPhone).toBe(true);
  });

  it("normalizes 10-digit US phone to E.164 (+1XXXXXXXXXX)", async () => {
    process.env.SALES_TOUR_BUYER_SMS_ENABLED = "true";
    process.env.TWILIO_ACCOUNT_SID = "AC1234";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_FROM_NUMBER = "+15551111111";
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ sid: "SM5678" }), { status: 201, headers: { "content-type": "application/json" } }),
    );
    global.fetch = fetchSpy as unknown as typeof global.fetch;
    const q = composeBoothQuote(intent({ contactPhone: "5551234567" }), { now: FIXED_NOW });
    const r = await smsBuyerNcsLink(q);
    expect(r.ok).toBe(true);
    expect(r.messageSid).toBe("SM5678");
    const callArgs = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(callArgs[1].body).toContain("To=%2B15551234567"); // +15551234567
  });

  it("normalizes formatted phone to E.164 (handles dashes/spaces/parens)", async () => {
    process.env.SALES_TOUR_BUYER_SMS_ENABLED = "true";
    process.env.TWILIO_ACCOUNT_SID = "AC1234";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_FROM_NUMBER = "+15551111111";
    global.fetch = (async () =>
      new Response(JSON.stringify({ sid: "SM" }), { status: 201, headers: { "content-type": "application/json" } })) as unknown as typeof global.fetch;
    const q = composeBoothQuote(intent({ contactPhone: "(555) 123-4567" }), { now: FIXED_NOW });
    const r = await smsBuyerNcsLink(q);
    expect(r.ok).toBe(true);
  });

  it("rejects malformed phone (not 7/10/11 digits)", async () => {
    process.env.SALES_TOUR_BUYER_SMS_ENABLED = "true";
    process.env.TWILIO_ACCOUNT_SID = "AC1234";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_FROM_NUMBER = "+15551111111";
    const q = composeBoothQuote(intent({ contactPhone: "555-1212" }), { now: FIXED_NOW });
    const r = await smsBuyerNcsLink(q);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/doesn't normalize/);
  });

  it("preserves explicit E.164 input", async () => {
    process.env.SALES_TOUR_BUYER_SMS_ENABLED = "true";
    process.env.TWILIO_ACCOUNT_SID = "AC1234";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_FROM_NUMBER = "+15551111111";
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ sid: "SM" }), { status: 201, headers: { "content-type": "application/json" } }),
    );
    global.fetch = fetchSpy as unknown as typeof global.fetch;
    const q = composeBoothQuote(intent({ contactPhone: "+15551234567" }), { now: FIXED_NOW });
    const r = await smsBuyerNcsLink(q);
    expect(r.ok).toBe(true);
    const callArgs = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(callArgs[1].body).toContain("To=%2B15551234567");
  });

  it("returns ok:false on Twilio HTTP error (does not throw)", async () => {
    process.env.SALES_TOUR_BUYER_SMS_ENABLED = "true";
    process.env.TWILIO_ACCOUNT_SID = "AC1234";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_FROM_NUMBER = "+15551111111";
    global.fetch = (async () =>
      new Response("invalid To", { status: 400 })) as unknown as typeof global.fetch;
    const q = composeBoothQuote(intent({ contactPhone: "5551234567" }), { now: FIXED_NOW });
    const r = await smsBuyerNcsLink(q);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Twilio HTTP 400/);
    expect(r.bodySent).toBeTruthy();
    expect(r.ncsDeepLink).toBeTruthy();
  });
});
