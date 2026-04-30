import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readDay1Prospects, readSalesTourPlaybook } from "../sales-command-readers";

describe("readDay1Prospects", () => {
  it("reads the checked-in Day 1 CSV as a wired count source", async () => {
    const result = await readDay1Prospects();
    expect(result.status).toBe("wired");
    if (result.status !== "wired") return;
    expect(result.value.total).toBeGreaterThan(70);
    expect(result.value.emailReady).toBeGreaterThan(0);
    expect(result.value.priorityA).toBeGreaterThan(0);
    expect(result.value.needsManualResearch).toBeGreaterThan(0);
  });

  it("reader source imports no send or CRM write clients", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/ops/sales-command-readers.ts"),
      "utf8",
    );
    const sendReaderSlice = source.slice(
      source.indexOf("export async function readDay1Prospects"),
      source.indexOf("export async function readSalesPipeline"),
    );
    expect(sendReaderSlice).not.toMatch(/send-email|gmail|hubspot|apollo|qbo/i);
  });
});

describe("readSalesTourPlaybook", () => {
  it("reads the checked-in May sales-tour contract as a wired count source", async () => {
    const result = await readSalesTourPlaybook();
    expect(result.status).toBe("wired");
    if (result.status !== "wired") return;
    expect(result.value.total).toBeGreaterThan(70);
    expect(result.value.warmOrHot).toBeGreaterThan(0);
    expect(result.value.verifiedEmails).toBeGreaterThan(0);
    expect(result.value.researchNeeded).toBeGreaterThan(0);
  });

  it("reader source imports no send or CRM write clients", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/ops/sales-command-readers.ts"),
      "utf8",
    );
    const sendReaderSlice = source.slice(
      source.indexOf("export async function readSalesTourPlaybook"),
      source.indexOf("export async function readSalesPipeline"),
    );
    expect(sendReaderSlice).not.toMatch(/send-email|gmail|hubspot|apollo|qbo/i);
  });
});
