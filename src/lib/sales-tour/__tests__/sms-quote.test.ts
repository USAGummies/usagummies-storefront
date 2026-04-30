/**
 * Tests for the Sales-Tour Twilio SMS-to-Ben helper (v0.2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BoothVisitIntent } from "@/lib/sales-tour/booth-visit-types";
import { composeBoothQuote } from "@/lib/sales-tour/compose-booth-quote";
import { composeSmsBody, smsQuoteSummary } from "@/lib/sales-tour/sms-quote";

const ORIGINAL_FETCH = global.fetch;
const ENV_KEYS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "SALES_TOUR_BEN_SMS_TO",
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
    contactName: null,
    contactPhone: null,
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

describe("composeSmsBody — under-2-segment summary", () => {
  it("includes prospect, state, line label, and NCS link", () => {
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const body = composeSmsBody(q);
    expect(body).toContain("Bryce Glamp and Camp (UT)");
    expect(body).toContain("$3.49");
    expect(body).toContain("usagummies.com/upload/ncs");
    expect(body).toContain(`Visit ${q.visitId}`);
  });

  it("strips Slack markdown (asterisks, backticks)", () => {
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const body = composeSmsBody(q);
    expect(body).not.toContain("*");
    expect(body).not.toContain("`");
  });

  it("adds Class C deal-check warning when required", () => {
    const q = composeBoothQuote(
      intent({ scale: "pallet", count: 3, totalBags: 2700, freightAsk: "anchor" }),
      { now: FIXED_NOW },
    );
    const body = composeSmsBody(q);
    expect(body).toContain("Class C deal-check");
  });

  it("omits the Class C warning for grid-priced quotes", () => {
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const body = composeSmsBody(q);
    expect(body).not.toContain("Class C deal-check");
  });
});

describe("smsQuoteSummary — Twilio integration", () => {
  it("returns ok:false skipped:true when Twilio env not configured", async () => {
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const r = await smsQuoteSummary(q);
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe(true);
    expect(r.error).toMatch(/Twilio env not fully configured/);
  });

  it("returns ok:false skipped:true when only some env vars set", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC1234";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    // Missing FROM + TO
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const r = await smsQuoteSummary(q);
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe(true);
  });

  it("POSTs to Twilio with form-encoded body when env is configured", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC1234";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_FROM_NUMBER = "+15551111111";
    process.env.SALES_TOUR_BEN_SMS_TO = "+14358967765";
    const fetchSpy = vi.fn(async () => {
      return new Response(JSON.stringify({ sid: "SM1234" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    global.fetch = fetchSpy as unknown as typeof global.fetch;
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const r = await smsQuoteSummary(q);
    expect(r.ok).toBe(true);
    expect(r.messageSid).toBe("SM1234");
    expect(r.bodySent).toContain("Bryce Glamp and Camp (UT)");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callArgs = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const url = callArgs[0];
    const init = callArgs[1];
    expect(url).toContain("/Accounts/AC1234/Messages.json");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    expect(init.body).toContain("From=%2B15551111111");
    expect(init.body).toContain("To=%2B14358967765");
  });

  it("returns ok:false on Twilio HTTP 4xx (does not throw)", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC1234";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_FROM_NUMBER = "+15551111111";
    process.env.SALES_TOUR_BEN_SMS_TO = "+14358967765";
    global.fetch = (async () =>
      new Response("invalid 'To' number", { status: 400 })) as unknown as typeof global.fetch;
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const r = await smsQuoteSummary(q);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Twilio HTTP 400/);
    expect(r.bodySent).toBeTruthy();
  });

  it("returns ok:false on network error", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC1234";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_FROM_NUMBER = "+15551111111";
    process.env.SALES_TOUR_BEN_SMS_TO = "+14358967765";
    global.fetch = (async () => {
      throw new Error("ENETUNREACH");
    }) as unknown as typeof global.fetch;
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const r = await smsQuoteSummary(q);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Twilio fetch failed.*ENETUNREACH/);
  });
});
