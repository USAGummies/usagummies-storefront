/**
 * PRODUCT CLAIMS REGISTRY — Outreach Claim Verification Gate
 *
 * Every product claim that appears in outreach emails MUST be registered here
 * with a verification status and source citation. The validateOutreachClaims()
 * function scans draft email text and blocks any unverified/false claims.
 *
 * This was built after Viktor's self-audit uncovered 4 false claims across
 * 438+ outreach emails:
 *   - "Layton, Utah" (hallucinated location — Powers is in Spokane, WA)
 *   - "Veteran-owned" (confirmed true by Ben on 2026-04-09)
 *   - "Halal" (NOT in Albanese spec sheet, gelatin source unspecified)
 *   - "Kosher" (NOT in Albanese spec sheet)
 *
 * RULES:
 * 1. Only VERIFIED claims can appear in outreach.
 * 2. UNVERIFIED claims are blocked with a warning.
 * 3. FALSE claims are blocked with an error.
 * 4. New claims MUST be added here with source docs before use.
 */

import { kv } from "@vercel/kv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClaimStatus = "verified" | "unverified" | "false";

export interface ProductClaim {
  /** Unique key for this claim (lowercase, kebab-case) */
  id: string;
  /** The claim text as it might appear in outreach */
  claim: string;
  /** Verification status */
  status: ClaimStatus;
  /** Source document or confirmation (e.g., "Albanese spec sheet 50270_5", "Ben confirmed 2026-04-09") */
  source: string;
  /** When this was last verified */
  verified_date?: string;
  /** Who verified it */
  verified_by?: string;
  /** Additional context */
  notes?: string;
  /** Search patterns — regex strings that match this claim in email text */
  patterns: string[];
}

export interface ClaimCheckResult {
  /** Whether the outreach text is safe to send */
  safe: boolean;
  /** Claims found in the text */
  found_claims: Array<{
    claim_id: string;
    claim: string;
    status: ClaimStatus;
    source: string;
    matched_text: string;
    notes?: string;
  }>;
  /** Blocked claims (unverified or false) */
  blocked: Array<{
    claim_id: string;
    claim: string;
    status: ClaimStatus;
    reason: string;
  }>;
  /** Summary for Viktor/caller */
  summary: string;
}

// ---------------------------------------------------------------------------
// Built-in Verified Claims Registry
// ---------------------------------------------------------------------------

const BUILT_IN_CLAIMS: ProductClaim[] = [
  // ── PRODUCT IDENTITY ──
  {
    id: "dye-free",
    claim: "Dye-free gummy candy",
    status: "verified",
    source: "Core product identity — no artificial dyes used. Albanese spec sheet confirms natural flavors.",
    verified_date: "2026-04-09",
    verified_by: "ben",
    patterns: ["dye.?free", "no.?artificial.?dye", "no.?synthetic.?dye", "no.?artificial.?color"],
  },
  {
    id: "natural-flavors",
    claim: "Made with natural flavors",
    status: "verified",
    source: "Albanese spec sheet 50270_5_Natural_Flavor_Gummi_Bears_Specification_11_20_2024",
    verified_date: "2026-04-09",
    verified_by: "ben",
    patterns: ["natural.?flavor", "naturally.?flavored"],
  },
  {
    id: "gluten-free",
    claim: "Gluten free",
    status: "verified",
    source: "Albanese spec sheet — listed as Gluten Free",
    verified_date: "2026-04-09",
    verified_by: "ben",
    patterns: ["gluten.?free"],
  },
  {
    id: "fat-free",
    claim: "Fat free",
    status: "verified",
    source: "Albanese spec sheet — 0g fat per serving",
    verified_date: "2026-04-09",
    verified_by: "ben",
    patterns: ["fat.?free", "0g?.?fat", "zero.?fat"],
  },
  {
    id: "made-in-usa",
    claim: "Made in the USA",
    status: "verified",
    source: "Albanese manufacturing in Merrillville, IN. Powers co-packing in Spokane, WA. Both USA.",
    verified_date: "2026-04-09",
    verified_by: "ben",
    patterns: ["made.?in.?(the.?)?us(a)?", "american.?made", "domestically.?made"],
  },
  {
    id: "product-name",
    claim: "All American Gummy Bears",
    status: "verified",
    source: "Official product name",
    verified_date: "2026-04-09",
    verified_by: "ben",
    patterns: ["all.?american.?gummy.?bear"],
  },
  {
    id: "bag-size",
    claim: "7.5 oz bag",
    status: "verified",
    source: "Product packaging spec",
    verified_date: "2026-04-09",
    verified_by: "ben",
    patterns: ["7\\.?5\\s*oz"],
  },

  // ── SUPPLY CHAIN ──
  {
    id: "veteran-owned-copacker",
    claim: "Co-packed by a veteran-owned facility",
    status: "verified",
    source: "Ben confirmed Powers Confections is veteran-owned (2026-04-09)",
    verified_date: "2026-04-09",
    verified_by: "ben",
    patterns: ["veteran.?owned"],
  },
  {
    id: "powers-spokane",
    claim: "Co-packed in Spokane, WA",
    status: "verified",
    source: "Powers Confections facility address — Spokane, WA",
    verified_date: "2026-04-09",
    verified_by: "ben",
    patterns: ["spokane", "powers.?confection", "powers.?food"],
  },

  // ── FALSE / UNVERIFIED CLAIMS (BLOCKED) ──
  {
    id: "halal",
    claim: "Halal certified",
    status: "unverified",
    source: "NOT in Albanese spec sheet. Gelatin source unspecified — may be pork-derived.",
    notes: "Do NOT use until Albanese provides Halal certification documentation.",
    verified_date: "2026-04-09",
    verified_by: "viktor-audit",
    patterns: ["halal"],
  },
  {
    id: "kosher",
    claim: "Kosher certified",
    status: "unverified",
    source: "NOT in Albanese spec sheet. Gelatin source unspecified.",
    notes: "Do NOT use until Albanese provides Kosher certification documentation.",
    verified_date: "2026-04-09",
    verified_by: "viktor-audit",
    patterns: ["kosher"],
  },
  {
    id: "layton-utah",
    claim: "Located in Layton, Utah",
    status: "false",
    source: "HALLUCINATED by Viktor. USA Gummies is a WA C-Corp. Powers is in Spokane, WA. No connection to Layton, UT.",
    notes: "Was included in 194 v1 outreach emails. Completely fabricated.",
    verified_date: "2026-04-09",
    verified_by: "viktor-audit",
    patterns: ["layton", "utah"],
  },

  // ── PRICING ──
  {
    id: "msrp-499",
    claim: "MSRP $4.99",
    status: "verified",
    source: "DTC pricing on usagummies.com",
    verified_date: "2026-04-09",
    verified_by: "ben",
    patterns: ["\\$4\\.99\\s*(msrp|retail|srp)?"],
  },
  {
    id: "amazon-price",
    claim: "Available on Amazon at $5.99",
    status: "verified",
    source: "Amazon listing price",
    verified_date: "2026-04-09",
    verified_by: "ben",
    patterns: ["\\$5\\.99"],
  },

  // ── COMPANY ──
  {
    id: "c-corp",
    claim: "C Corporation",
    status: "verified",
    source: "Wyoming Attorneys LLC — corporate filing",
    verified_date: "2026-04-09",
    verified_by: "ben",
    patterns: ["c.?corp"],
  },
];

// ---------------------------------------------------------------------------
// KV Storage for dynamic claims (added at runtime)
// ---------------------------------------------------------------------------

const KV_CLAIMS_REGISTRY = "product:claims";

/**
 * Get all claims — built-in + any dynamic ones from KV.
 */
export async function getAllClaims(): Promise<ProductClaim[]> {
  const dynamic = await getDynamicClaims();
  // Dynamic claims override built-in ones with same ID
  const dynamicIds = new Set(dynamic.map((c) => c.id));
  const builtIn = BUILT_IN_CLAIMS.filter((c) => !dynamicIds.has(c.id));
  return [...builtIn, ...dynamic];
}

async function getDynamicClaims(): Promise<ProductClaim[]> {
  try {
    return (await kv.get<ProductClaim[]>(KV_CLAIMS_REGISTRY)) || [];
  } catch {
    return [];
  }
}

/**
 * Add or update a claim in the dynamic registry.
 */
export async function upsertClaim(claim: ProductClaim): Promise<void> {
  const existing = await getDynamicClaims();
  const idx = existing.findIndex((c) => c.id === claim.id);
  if (idx >= 0) {
    existing[idx] = claim;
  } else {
    existing.push(claim);
  }
  await kv.set(KV_CLAIMS_REGISTRY, existing);
}

/**
 * Get a single claim by ID.
 */
export async function getClaim(id: string): Promise<ProductClaim | null> {
  const all = await getAllClaims();
  return all.find((c) => c.id === id) || null;
}

// ---------------------------------------------------------------------------
// Outreach Validation — THE GATE
// ---------------------------------------------------------------------------

/**
 * Scan outreach email text for product claims and validate each one.
 *
 * Returns { safe, found_claims, blocked, summary }.
 * If safe is false, the email MUST NOT be sent.
 *
 * Usage:
 *   const result = await validateOutreachClaims(emailSubject + "\n" + emailBody);
 *   if (!result.safe) { // block send, return result.blocked to caller }
 */
export async function validateOutreachClaims(text: string): Promise<ClaimCheckResult> {
  const allClaims = await getAllClaims();
  const foundClaims: ClaimCheckResult["found_claims"] = [];
  const blocked: ClaimCheckResult["blocked"] = [];

  for (const claim of allClaims) {
    for (const pat of claim.patterns) {
      const regex = new RegExp(pat, "gi");
      const match = regex.exec(text);
      if (match) {
        foundClaims.push({
          claim_id: claim.id,
          claim: claim.claim,
          status: claim.status,
          source: claim.source,
          matched_text: match[0],
          notes: claim.notes,
        });

        if (claim.status === "false") {
          blocked.push({
            claim_id: claim.id,
            claim: claim.claim,
            status: claim.status,
            reason: `FALSE CLAIM: ${claim.source}`,
          });
        } else if (claim.status === "unverified") {
          blocked.push({
            claim_id: claim.id,
            claim: claim.claim,
            status: claim.status,
            reason: `UNVERIFIED: ${claim.notes || claim.source}`,
          });
        }

        break; // one match per claim is enough
      }
    }
  }

  const safe = blocked.length === 0;

  let summary: string;
  if (safe && foundClaims.length === 0) {
    summary = "No product claims detected in text. Safe to send.";
  } else if (safe) {
    summary = `${foundClaims.length} verified claim(s) found. All pass. Safe to send.`;
  } else {
    const falseCount = blocked.filter((b) => b.status === "false").length;
    const unverifiedCount = blocked.filter((b) => b.status === "unverified").length;
    summary = `BLOCKED: ${blocked.length} claim(s) failed validation` +
      (falseCount ? ` (${falseCount} false)` : "") +
      (unverifiedCount ? ` (${unverifiedCount} unverified)` : "") +
      `. Fix before sending.`;
  }

  return { safe, found_claims: foundClaims, blocked, summary };
}
