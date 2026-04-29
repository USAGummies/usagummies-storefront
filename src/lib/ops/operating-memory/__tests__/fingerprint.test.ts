/**
 * Fingerprint tests — same input → same digest, with deliberate
 * insensitivities (whitespace, case, sub-minute timestamp drift).
 */

import { describe, expect, it } from "vitest";

import { buildFingerprintInput, fingerprintEntry } from "../fingerprint";
import type { TranscriptCaptureInput } from "../types";

function input(overrides: Partial<TranscriptCaptureInput> = {}): TranscriptCaptureInput {
  return {
    body: "We're locking pricing at B1-B5 today.",
    source: { sourceSystem: "slack", sourceRef: "C0AKG9FSC2J:1714248192.001234" },
    actorId: "Ben",
    actorType: "human",
    capturedAt: "2026-04-27T19:30:42Z",
    division: "executive-control",
    ...overrides,
  };
}

describe("fingerprintEntry — stability", () => {
  it("identical inputs produce identical digests", () => {
    const a = fingerprintEntry(input());
    const b = fingerprintEntry(input());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("whitespace differences in body do not affect digest", () => {
    const a = fingerprintEntry(input({ body: "We're locking   pricing at B1-B5 today." }));
    const b = fingerprintEntry(input({ body: "We're locking pricing at B1-B5 today." }));
    expect(a).toBe(b);
  });

  it("case differences in body do not affect digest", () => {
    const a = fingerprintEntry(input({ body: "WE'RE LOCKING PRICING AT B1-B5 TODAY." }));
    const b = fingerprintEntry(input({ body: "we're locking pricing at b1-b5 today." }));
    expect(a).toBe(b);
  });

  it("sub-minute timestamp drift does not affect digest", () => {
    const a = fingerprintEntry(input({ capturedAt: "2026-04-27T19:30:42Z" }));
    const b = fingerprintEntry(input({ capturedAt: "2026-04-27T19:30:58Z" }));
    expect(a).toBe(b);
  });

  it("source-system case is normalized", () => {
    const a = fingerprintEntry(input({ source: { sourceSystem: "Slack", sourceRef: "X" } }));
    const b = fingerprintEntry(input({ source: { sourceSystem: "slack", sourceRef: "X" } }));
    expect(a).toBe(b);
  });
});

describe("fingerprintEntry — distinctness", () => {
  it("different bodies produce different digests", () => {
    expect(fingerprintEntry(input({ body: "A" }))).not.toBe(
      fingerprintEntry(input({ body: "B" })),
    );
  });

  it("different sourceRef produces different digests", () => {
    expect(
      fingerprintEntry(input({ source: { sourceSystem: "slack", sourceRef: "A" } })),
    ).not.toBe(
      fingerprintEntry(input({ source: { sourceSystem: "slack", sourceRef: "B" } })),
    );
  });

  it("different actorId produces different digests", () => {
    expect(fingerprintEntry(input({ actorId: "Ben" }))).not.toBe(
      fingerprintEntry(input({ actorId: "Rene" })),
    );
  });

  it("minute-aligned but different minutes produce different digests", () => {
    const a = fingerprintEntry(input({ capturedAt: "2026-04-27T19:30:00Z" }));
    const b = fingerprintEntry(input({ capturedAt: "2026-04-27T19:31:00Z" }));
    expect(a).not.toBe(b);
  });
});

describe("buildFingerprintInput — version pinning", () => {
  it("includes a v1 prefix so future schema changes can rotate", () => {
    expect(buildFingerprintInput(input())).toMatch(/^v1\|/);
  });
});
