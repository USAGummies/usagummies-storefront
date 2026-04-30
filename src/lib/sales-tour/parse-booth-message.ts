/**
 * LLM-based parser for booth-visit Slack messages.
 *
 * Doctrine: `/contracts/sales-tour-field-workflow.md` §2.1 (input grammar).
 *
 * Strategy:
 *   1. Pure deterministic regex pre-pass extracts the obvious bits (count,
 *      scale, state). Cheap + handles the 90% case without an API call.
 *   2. If pre-pass yields a high-confidence intent, return immediately
 *      (no LLM call — fast booth-side latency).
 *   3. Otherwise fall back to an Anthropic `/v1/messages` call with strict
 *      JSON output. Same pattern as `pipeline/enrich`, `inbox/triage`.
 *
 * Returns null on hard parse failure so the route can post a "I couldn't
 * parse that — try `/booth 36 to <prospect> <state>, landed`" reply.
 */
import { BAGS_PER_UNIT } from "@/lib/wholesale/pricing-tiers";

import type {
  BoothVisitIntent,
  FreightAsk,
  QuantityScale,
  StateCode,
} from "./booth-visit-types";

/** All US two-letter state codes for the deterministic regex pass. */
const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
]);

const SCALE_WORDS: Record<string, QuantityScale> = {
  pallet: "pallet",
  pallets: "pallet",
  master: "master-carton",
  carton: "master-carton",
  cartons: "master-carton",
  case: "case",
  cases: "case",
  sample: "sample",
  samples: "sample",
};

const FREIGHT_WORDS: Record<string, FreightAsk> = {
  landed: "landed",
  pickup: "pickup",
  "buyer pays": "pickup",
  "buyer-pays": "pickup",
  "buyer freight": "pickup",
  anchor: "anchor",
  fill: "fill",
  unsure: "unsure",
};

// 10-digit ((+1) optional) US phone OR 7-digit short form (booth shorthand
// for area-code-omitted numbers Ben might capture). The 7-digit fallback is
// the second alternative so the 10-digit pattern wins when both apply.
const PHONE_RE = /(?:(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|\b\d{3}[\s.-]?\d{4}\b)/;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

function bagsForScale(scale: QuantityScale, count: number): number {
  switch (scale) {
    case "pallet":
      return count * BAGS_PER_UNIT.B4; // 900
    case "master-carton":
      return count * BAGS_PER_UNIT.B2; // 36
    case "case":
      return count * BAGS_PER_UNIT.B1; // 6
    case "sample":
      return count; // single-bag samples
  }
}

/** Find a state code in the message. Prefers explicit two-letter mentions. */
function detectState(text: string): StateCode | null {
  // Word-boundary match for two-letter state codes (uppercase preferred).
  const match = text.toUpperCase().match(/\b(A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b/);
  if (match && US_STATES.has(match[1])) return match[1];
  return null;
}

/** Find quantity + scale in the message. */
function detectQuantityScale(text: string): { count: number; scale: QuantityScale } | null {
  const lower = text.toLowerCase();
  // Tier 1: explicit "<n> <unit>" — "3 pallets", "8 cases", "1 master carton", "36 bags".
  const re = /(\d+)\s*(pallets?|master\s*cartons?|cartons?|cases?|samples?|bags?)/;
  const m = lower.match(re);
  if (m) {
    const count = parseInt(m[1], 10);
    const word = m[2].replace(/\s+/g, "").replace(/s$/, "");
    if (word === "bag") return inferScaleFromBagCount(count);
    const normalized = word === "mastercarton" ? "master" : word;
    const scale = SCALE_WORDS[normalized] ?? null;
    if (scale) return { count, scale };
  }
  // Tier 2: bare number at the start of the message — "/booth 36 to ABC UT, landed".
  // Treat as a raw bag count and infer scale from the magnitude.
  const bareMatch = lower.match(/^\s*(\d+)\s+(?:to|at|for)\b/);
  if (bareMatch) {
    const n = parseInt(bareMatch[1], 10);
    if (n > 0) return inferScaleFromBagCount(n);
  }
  return null;
}

/** Infer the canonical scale from a raw bag count. */
function inferScaleFromBagCount(count: number): { count: number; scale: QuantityScale } {
  if (count >= BAGS_PER_UNIT.B4) {
    return { count: Math.round(count / BAGS_PER_UNIT.B4), scale: "pallet" };
  }
  if (count >= BAGS_PER_UNIT.B2) {
    return { count: Math.round(count / BAGS_PER_UNIT.B2), scale: "master-carton" };
  }
  if (count >= BAGS_PER_UNIT.B1) {
    return { count: Math.round(count / BAGS_PER_UNIT.B1), scale: "case" };
  }
  return { count, scale: "sample" };
}

/** Find the freight ask in the message. */
function detectFreightAsk(text: string): FreightAsk {
  const lower = text.toLowerCase();
  for (const [keyword, ask] of Object.entries(FREIGHT_WORDS)) {
    if (lower.includes(keyword)) return ask;
  }
  return "unsure";
}

/** Strip the leading slash command (e.g. `/booth `) from the input. */
function stripCommand(text: string): string {
  return text.replace(/^\s*\/booth\s+/i, "").trim();
}

/**
 * Deterministic regex parser. Returns `null` when the message is too
 * fuzzy to confidently parse (typically because the prospect name + state
 * pattern doesn't match the grammar) — caller should fall through to the
 * LLM parser.
 */
export function parseBoothMessageRegex(rawText: string): BoothVisitIntent | null {
  const text = stripCommand(rawText);
  const qty = detectQuantityScale(text);
  if (!qty) return null;
  const state = detectState(text);
  if (!state) return null;
  // Prospect name = text between "to" / "at" and the state code (best-effort).
  // Falls back to text before "contact" or before the freight word.
  const prospect = (() => {
    const toMatch = text.match(/(?:to|at|for)\s+([^,]+?)\s+[A-Z]{2}\b/i);
    if (toMatch) return toMatch[1].trim();
    return null;
  })();
  const phoneMatch = text.match(PHONE_RE);
  const emailMatch = text.match(EMAIL_RE);
  // Contact name — heuristic: word(s) immediately before the phone or email,
  // typically "contact <Name> <phone>" or "<Name> <email>".
  const contactName = (() => {
    const m = text.match(/contact\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)/);
    if (m) return m[1];
    return null;
  })();
  const notes = (() => {
    const noteMatch = text.match(/notes?:\s*(.+?)$/i);
    if (noteMatch) return noteMatch[1].trim();
    return null;
  })();
  const totalBags = bagsForScale(qty.scale, qty.count);

  return {
    rawText,
    prospectName: prospect,
    state,
    city: null,
    scale: qty.scale,
    count: qty.count,
    totalBags,
    freightAsk: detectFreightAsk(text),
    contactName,
    contactPhone: phoneMatch ? phoneMatch[0] : null,
    contactEmail: emailMatch ? emailMatch[0] : null,
    notes,
    confidence: prospect && state ? 0.85 : 0.55,
  };
}

/**
 * Anthropic-backed parser fallback. Calls `/v1/messages` with a strict-JSON
 * system prompt. Same pattern as other Claude-backed routes in the repo.
 *
 * Throws on auth/network failure so the API route can return 502.
 */
export async function parseBoothMessageLLM(rawText: string): Promise<BoothVisitIntent> {
  const text = stripCommand(rawText);
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured — cannot run LLM parser fallback");
  }
  const model = process.env.ANTHROPIC_BOOTH_PARSER_MODEL || "claude-sonnet-4-6";

  const system = [
    "You are extracting structured fields from a sales-booth voice/text note.",
    "Respond with STRICT JSON only — no prose, no markdown fences, no commentary.",
    "Schema:",
    "{",
    '  "prospectName": string | null,',
    '  "state": string | null  // 2-letter US state code, uppercase',
    '  "city": string | null,',
    '  "scale": "sample" | "case" | "master-carton" | "pallet",',
    '  "count": number  // integer',
    '  "freightAsk": "landed" | "pickup" | "anchor" | "fill" | "unsure",',
    '  "contactName": string | null,',
    '  "contactPhone": string | null,',
    '  "contactEmail": string | null,',
    '  "notes": string | null,',
    '  "confidence": number  // 0..1',
    "}",
    "Rules:",
    "- A 'sample' is a free or paid drop of 1-6 bags.",
    "- 'case' = 6 bags. 'master-carton' = 36 bags. 'pallet' = 900 bags.",
    "- If the message says '36 bags', emit scale='master-carton' count=1.",
    "- If unsure about freight ask, emit 'unsure'.",
    "- Return null for fields you can't confidently extract.",
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      temperature: 0,
      system,
      messages: [{ role: "user", content: text }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic /v1/messages failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const textOut = data.content?.[0]?.text?.trim() ?? "";
  if (!textOut) throw new Error("Anthropic returned empty content");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(textOut) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Anthropic returned non-JSON: ${(err as Error).message}; first 200 chars: ${textOut.slice(0, 200)}`);
  }

  const scale = parsed.scale === "sample" || parsed.scale === "case" ||
    parsed.scale === "master-carton" || parsed.scale === "pallet"
      ? (parsed.scale as QuantityScale)
      : "case";
  const count = Number(parsed.count) || 0;
  const freightAsk = (
    parsed.freightAsk === "landed" || parsed.freightAsk === "pickup" ||
    parsed.freightAsk === "anchor" || parsed.freightAsk === "fill" ||
    parsed.freightAsk === "unsure"
      ? parsed.freightAsk
      : "unsure"
  ) as FreightAsk;

  return {
    rawText,
    prospectName: typeof parsed.prospectName === "string" ? parsed.prospectName : null,
    state: typeof parsed.state === "string" ? parsed.state.toUpperCase() : null,
    city: typeof parsed.city === "string" ? parsed.city : null,
    scale,
    count,
    totalBags: bagsForScale(scale, count),
    freightAsk,
    contactName: typeof parsed.contactName === "string" ? parsed.contactName : null,
    contactPhone: typeof parsed.contactPhone === "string" ? parsed.contactPhone : null,
    contactEmail: typeof parsed.contactEmail === "string" ? parsed.contactEmail : null,
    notes: typeof parsed.notes === "string" ? parsed.notes : null,
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7,
  };
}

/**
 * Composite parser: try regex first, fall back to LLM when regex fails or
 * confidence is low. The LLM call is opt-out via `useLlm: false` for tests
 * + offline development.
 */
export async function parseBoothMessage(
  rawText: string,
  opts: { useLlm?: boolean } = {},
): Promise<BoothVisitIntent | null> {
  const useLlm = opts.useLlm !== false;
  const regex = parseBoothMessageRegex(rawText);
  if (regex && regex.confidence >= 0.8) return regex;
  if (!useLlm) return regex;
  try {
    return await parseBoothMessageLLM(rawText);
  } catch {
    // Fail-soft: prefer the low-confidence regex result over a hard fail.
    return regex;
  }
}

/** Exported for tests. */
export { bagsForScale };
