import { describe, expect, it } from "vitest";

import {
  HUBSPOT_STAGE_PO_RECEIVED,
  HUBSPOT_STAGE_QUOTE_PO_SENT,
  HUBSPOT_STAGE_SHIPPED,
  HUBSPOT_TO_CANONICAL,
  canonicalStageFromHubspot,
} from "../hubspot-stage-mapping";

describe("canonicalStageFromHubspot", () => {
  it("maps every HubSpot stage to a canonical stage", () => {
    for (const [hsStage, canonical] of Object.entries(HUBSPOT_TO_CANONICAL)) {
      expect(canonicalStageFromHubspot(hsStage)).toBe(canonical);
    }
  });

  it("returns null on unknown stage", () => {
    expect(canonicalStageFromHubspot("unknown-stage")).toBeNull();
    expect(canonicalStageFromHubspot(null)).toBeNull();
    expect(canonicalStageFromHubspot(undefined)).toBeNull();
    expect(canonicalStageFromHubspot("")).toBeNull();
  });

  it("conservative mapping: 'Quote/PO Sent' maps to quote_sent (earlier of two)", () => {
    expect(canonicalStageFromHubspot(HUBSPOT_STAGE_QUOTE_PO_SENT)).toBe(
      "quote_sent",
    );
  });

  it("PO Received → po_received (the canonical PO stage)", () => {
    expect(canonicalStageFromHubspot(HUBSPOT_STAGE_PO_RECEIVED)).toBe(
      "po_received",
    );
  });

  it("Shipped HubSpot stage → shipped canonical stage", () => {
    expect(canonicalStageFromHubspot(HUBSPOT_STAGE_SHIPPED)).toBe("shipped");
  });
});
