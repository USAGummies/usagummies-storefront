import { describe, expect, it } from "vitest";

import {
  bagsForScale,
  parseBoothMessage,
  parseBoothMessageRegex,
} from "@/lib/sales-tour/parse-booth-message";

describe("parseBoothMessageRegex — fast path for the 90% case", () => {
  it("parses '/booth 36 to Bryce Glamp UT, landed, contact Sarah 555-1212'", () => {
    const r = parseBoothMessageRegex("/booth 36 to Bryce Glamp UT, landed, contact Sarah 555-1212");
    expect(r).not.toBeNull();
    expect(r!.scale).toBe("master-carton");
    expect(r!.count).toBe(1);
    expect(r!.totalBags).toBe(36);
    expect(r!.state).toBe("UT");
    expect(r!.freightAsk).toBe("landed");
    expect(r!.contactName).toBe("Sarah");
    expect(r!.contactPhone).toBe("555-1212");
  });

  it("parses '3 pallets to Indian Pueblo NM, anchor'", () => {
    const r = parseBoothMessageRegex("3 pallets to Indian Pueblo NM, anchor");
    expect(r).not.toBeNull();
    expect(r!.scale).toBe("pallet");
    expect(r!.count).toBe(3);
    expect(r!.totalBags).toBe(2700);
    expect(r!.state).toBe("NM");
    expect(r!.freightAsk).toBe("anchor");
  });

  it("parses '8 cases to Brian Head UT, pickup, jenny@brianhead.com'", () => {
    const r = parseBoothMessageRegex("8 cases to Brian Head UT, pickup, jenny@brianhead.com");
    expect(r).not.toBeNull();
    expect(r!.scale).toBe("case");
    expect(r!.count).toBe(8);
    expect(r!.totalBags).toBe(48);
    expect(r!.state).toBe("UT");
    expect(r!.freightAsk).toBe("pickup");
    expect(r!.contactEmail).toBe("jenny@brianhead.com");
  });

  it("parses '1 sample drop at Verde Canyon RR AZ'", () => {
    const r = parseBoothMessageRegex("1 sample drop at Verde Canyon RR AZ");
    expect(r).not.toBeNull();
    expect(r!.scale).toBe("sample");
    expect(r!.count).toBe(1);
    expect(r!.totalBags).toBe(1);
    expect(r!.state).toBe("AZ");
  });

  it("infers scale from bag count when buyer says 36 bags", () => {
    const r = parseBoothMessageRegex("36 bags to Anywhere CO, landed");
    expect(r).not.toBeNull();
    expect(r!.scale).toBe("master-carton");
    expect(r!.count).toBe(1);
    expect(r!.totalBags).toBe(36);
  });

  it("infers pallet scale from 1800 bags", () => {
    const r = parseBoothMessageRegex("1800 bags to Las Vegas NV, anchor");
    expect(r).not.toBeNull();
    expect(r!.scale).toBe("pallet");
    expect(r!.count).toBe(2);
    expect(r!.totalBags).toBe(1800);
  });

  it("returns null when neither quantity nor state can be detected", () => {
    expect(parseBoothMessageRegex("hi how are you")).toBeNull();
    expect(parseBoothMessageRegex("")).toBeNull();
    // No quantity:
    expect(parseBoothMessageRegex("send something to UT please")).toBeNull();
    // No state:
    expect(parseBoothMessageRegex("3 pallets please")).toBeNull();
  });

  it("defaults freight ask to 'unsure' when not explicit", () => {
    const r = parseBoothMessageRegex("36 bags to Generic Co UT");
    expect(r).not.toBeNull();
    expect(r!.freightAsk).toBe("unsure");
  });

  it("strips leading /booth slash command", () => {
    const r = parseBoothMessageRegex("/booth 36 to ABC UT, landed");
    expect(r).not.toBeNull();
    expect(r!.totalBags).toBe(36);
  });

  it("captures notes after `notes:` keyword", () => {
    const r = parseBoothMessageRegex("36 to ABC UT, landed, notes: needs delivery before 5pm");
    expect(r).not.toBeNull();
    expect(r!.notes).toBe("needs delivery before 5pm");
  });

  it("captures email when present even without explicit `contact` keyword", () => {
    const r = parseBoothMessageRegex("3 pallets to ABC UT, anchor, mike@abc.com");
    expect(r).not.toBeNull();
    expect(r!.contactEmail).toBe("mike@abc.com");
  });
});

describe("bagsForScale — canonical pack-math", () => {
  it("returns canonical bag counts per scale", () => {
    expect(bagsForScale("sample", 1)).toBe(1);
    expect(bagsForScale("case", 1)).toBe(6);
    expect(bagsForScale("master-carton", 1)).toBe(36);
    expect(bagsForScale("pallet", 1)).toBe(900);
    expect(bagsForScale("pallet", 3)).toBe(2700);
  });
});

describe("parseBoothMessage — regex-then-LLM-fallback", () => {
  it("returns regex result when confidence is high, no LLM call", async () => {
    const r = await parseBoothMessage("36 to Bryce Glamp UT, landed, contact Sarah 555-1212", {
      useLlm: false,
    });
    expect(r).not.toBeNull();
    expect(r!.confidence).toBeGreaterThanOrEqual(0.8);
    expect(r!.totalBags).toBe(36);
  });

  it("returns null when regex fails and LLM disabled", async () => {
    const r = await parseBoothMessage("hi", { useLlm: false });
    expect(r).toBeNull();
  });
});
