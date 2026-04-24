/**
 * Sample-request → shipping bridge.
 *
 * When the email-intelligence classifier flags an inbound email as
 * `sample_request`, this module:
 *
 *   1. Tries to extract a complete US ship-to from the email body
 *      (name + street + city + state + postalCode).
 *   2. Decides if we have enough to build a sample shipment intent.
 *   3. Returns either:
 *        - { ready: true, intent } → orchestrator POSTs to
 *          /api/ops/agents/sample-dispatch/dispatch which opens a
 *          Class B `shipment.create` approval in #ops-approvals.
 *        - { ready: false, missing: [...fields] } → orchestrator skips
 *          the dispatch hand-off; the existing email-intel draft (which
 *          already asks for the missing details) goes out as the reply.
 *
 * The extractor is deterministic (regex + state-code/ZIP heuristics).
 * It MAY produce false negatives — when uncertain, we say so and let
 * the human ask. We never invent addresses (hard-rules §7).
 *
 * Channel preservation: Amazon FBM, Shopify orders-paid, and HubSpot
 * deal-stage paths each have their own existing dispatch entry points.
 * This module only adds the "free-form email" path with channel="manual"
 * + tags=["sample"]. It does NOT collapse or replace the others.
 */
import type { OrderIntent } from "@/lib/ops/sample-order-dispatch";
import type { EmailEnvelope } from "@/lib/ops/gmail-reader";

/** US two-letter state code allowlist for confidence. */
const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
]);

/**
 * Single line of "City, ST 12345" (with optional ZIP+4).
 * Note: city chars exclude `.` so we don't bleed across "DR. CITYNAME"
 * when the address line packs street + city in one breath.
 */
const CITY_STATE_ZIP_REGEX =
  /([A-Za-z][A-Za-z '-]*[A-Za-z])\s*,\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/g;

/**
 * Heuristic street detector. Finds a digit-prefixed token followed by a
 * recognizable USPS street-suffix anywhere in the body. We can't anchor
 * to line-start because real emails embed the address after prose like
 * "Please ship to 5972 CHICKNEY DR." or "Address: 5972 CHICKNEY DR".
 *
 * Matches:
 *   "123 Main St"  "5972 CHICKNEY DR"  "44 S SR 12 Way"
 * Rejects free-form non-street numbers because the suffix gate is required.
 */
const STREET_LINE_REGEX =
  /\b(\d{1,6}\s+[A-Za-z][A-Za-z0-9 .'-]*?\s+(?:ST|STREET|AVE|AVENUE|RD|ROAD|BLVD|BOULEVARD|DR|DRIVE|LN|LANE|WAY|CT|COURT|PL|PLACE|HWY|HIGHWAY|SR|TRL|TRAIL|PKWY|PARKWAY|CIR|CIRCLE|TER|TERRACE|SQ|SQUARE))\b/i;

/** Sender-name extractor: prefer "Name <addr@host>" then bare addr. */
function senderName(env: EmailEnvelope): string {
  const m = env.from?.match(/^([^<]+)</);
  if (m) return m[1].trim().replace(/^"|"$/g, "");
  const bare = env.from?.split("@")[0] ?? "";
  return bare.trim() || "Sample request";
}

export interface ParsedShipTo {
  name?: string;
  company?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  /** Which fields were confidently extracted vs guessed. */
  confidence: "high" | "medium" | "low";
}

/**
 * Try to parse a ship-to from the email body. Walks line-by-line and
 * looks for a tight cluster: street line + city/state/ZIP line.
 * Sender's display name is the default `name`. Returns whatever was
 * extracted; the caller decides whether it's enough.
 */
export function parseShipToFromEmail(env: EmailEnvelope): ParsedShipTo {
  const body = `${env.snippet ?? ""}\n${env.subject ?? ""}`;
  const result: ParsedShipTo = {
    name: senderName(env),
    confidence: "low",
  };

  // City/State/ZIP pass — global regex, take the first hit with a
  // valid state code.
  const cszMatches = Array.from(body.matchAll(CITY_STATE_ZIP_REGEX));
  for (const match of cszMatches) {
    const [, city, state, zip] = match;
    if (US_STATES.has(state.toUpperCase())) {
      result.city = city.trim();
      result.state = state.toUpperCase();
      result.postalCode = zip;
      break;
    }
  }

  // Street pass — first match anywhere in the body of "<number> <words>
  // <suffix>". Run against full body, not per-line, because real emails
  // wrap the address inside prose ("Address: 5972 CHICKNEY DR.").
  const streetMatch = body.match(STREET_LINE_REGEX);
  if (streetMatch) {
    result.street1 = streetMatch[1].replace(/\s+/g, " ").trim();
  }

  // Confidence ladder.
  const have = [
    result.name,
    result.street1,
    result.city,
    result.state,
    result.postalCode,
  ].filter(Boolean).length;
  if (have >= 5) result.confidence = "high";
  else if (have >= 4) result.confidence = "medium";
  else result.confidence = "low";

  return result;
}

export interface SampleRequestEvaluation {
  /** True when we have all 5 required ship-to fields and can dispatch. */
  ready: boolean;
  /** Field names missing when ready=false. Suitable for surfacing in the draft reply. */
  missing: Array<"name" | "street1" | "city" | "state" | "postalCode">;
  parsed: ParsedShipTo;
  /** Concrete OrderIntent payload, populated only when ready=true. */
  intent?: OrderIntent;
}

/**
 * Evaluate a sample-request email + decide whether to dispatch.
 *
 * Defaults:
 *   - channel: "manual"  — distinguishes free-form email from Shopify/Amazon/HubSpot paths
 *   - tags:    ["sample"] — classifier downstream picks east-coast origin (Drew) for samples
 *   - packagingType: "case"  — single 6-pack case is the canonical sample shipment
 *   - cartons: 1
 *
 * Caller (the orchestrator) is responsible for actually POSTing the
 * intent to /api/ops/agents/sample-dispatch/dispatch.
 */
export function evaluateSampleRequest(
  env: EmailEnvelope,
): SampleRequestEvaluation {
  const parsed = parseShipToFromEmail(env);
  const missing: SampleRequestEvaluation["missing"] = [];
  if (!parsed.name) missing.push("name");
  if (!parsed.street1) missing.push("street1");
  if (!parsed.city) missing.push("city");
  if (!parsed.state) missing.push("state");
  if (!parsed.postalCode) missing.push("postalCode");

  if (missing.length > 0) {
    return { ready: false, missing, parsed };
  }

  const intent: OrderIntent = {
    channel: "manual",
    sourceId: `email:${env.id}`,
    orderNumber: `SAMPLE-${env.id.slice(0, 12).toUpperCase()}`,
    tags: ["sample", "from-email"],
    note: `Sample request via inbound email "${env.subject}" from ${env.from}`,
    shipTo: {
      name: parsed.name!,
      street1: parsed.street1!,
      city: parsed.city!,
      state: parsed.state!,
      postalCode: parsed.postalCode!,
      country: "US",
      residential: true,
    },
    packagingType: "case",
    cartons: 1,
  };

  return { ready: true, missing: [], parsed, intent };
}
