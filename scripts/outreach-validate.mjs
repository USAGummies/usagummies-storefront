#!/usr/bin/env node
/**
 * Outreach Pre-Send Validator
 *
 * Enforces `/contracts/outreach-pitch-spec.md` §11 gate on any cold outbound email
 * before it can be sent. Fact-based, zero tolerance for pattern-matched claims.
 *
 * Usage:
 *   node scripts/outreach-validate.mjs --email=rdouglas@guestservices.com --body=draft.txt
 *
 * Flags (all required for a production pass):
 *   --email <addr>    Target recipient — must Apollo-verify
 *   --body <path>     Path to draft body (plain text)
 *   --skip-apollo     Dev-only: skip Apollo verify
 *   --skip-hubspot    Dev-only: skip HubSpot dedup
 *   --skip-gmail      Dev-only: skip Gmail sent dedup
 *
 * Exit codes:
 *   0 = PASS — safe to send
 *   1 = BLOCK — do not send
 *   2 = config/usage error
 */

import fs from "node:fs";
import path from "node:path";

// -------------------------------------------------------------------- Args
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      return [k, v ?? true];
    }
    return [a, true];
  })
);

if (!args.email || !args.body) {
  console.error("USAGE: outreach-validate.mjs --email=<addr> --body=<path>");
  process.exit(2);
}
const bodyPath = path.resolve(args.body);
if (!fs.existsSync(bodyPath)) {
  console.error(`BODY NOT FOUND: ${bodyPath}`);
  process.exit(2);
}
const bodyText = fs.readFileSync(bodyPath, "utf8");

// -------------------------------------------------------------- Blocked patterns
// Exact drift class from 2026-04-23 incident — never repeat
const BLOCKED = [
  { re: /resealable/i, label: "Blocked term 'resealable' — bag is NOT resealable" },
  { re: /red,?\s*white,?\s*and\s*blue\s+(bears|gummies|gummy)/i, label: "Blocked term 'red white and blue' — product is 5 flavors, not color-themed" },
  { re: /\blayton\b/i, label: "Blocked term 'Layton' — hallucinated location" },
  { re: /\bhalal\b/i, label: "Blocked claim 'halal' — not certified" },
  { re: /\bkosher\b/i, label: "Blocked claim 'kosher' — not certified" },
  { re: /dairy[\s-]?free/i, label: "Blocked 'dairy-free' — outside outreach scope per 2026-04-23 ruling" },
  { re: /peanut[\s-]?free/i, label: "Blocked 'peanut-free' — facility cross-contact" },
  { re: /\$2\.49\s*\/?\s*bag/i, label: "Blocked price $2.49/bag — distributor tier, not direct retail" },
  { re: /\$2\.10\s*\/?\s*bag/i, label: "Blocked price $2.10/bag — Option B distributor only" },
  { re: /100\s*(master\s*cartons?|MCs?)\s*(\/|per|=)\s*(3,?600|3600)\s*bags/i, label: "Wrong pallet size — canonical is 25 MCs / 900 bags" },
  { re: /three\s*(different\s*)?flavors|four\s*(different\s*)?flavors|six\s*(different\s*)?flavors|seven\s*(different\s*)?flavors/i, label: "Wrong flavor count — canonical is 5 flavors" },
  { re: /\bapple\s+(gummy|gummies|flavor)/i, label: "Use 'green apple' (never just 'apple') per canonical spec" },
];

// ---------------------------------------------------------- Required tokens
// Any cold-retail email should reference at least one of these to be a valid pitch
const REQUIRED_ANY = [
  /All American Gummy Bears/i,
  /7\.5\s*oz/i,
];

// ----------------------------------------------------- Pricing must be canonical
// If any of these appear, they must match the LOCKED tier exactly
const PRICING_GATES = [
  { re: /\$3\.25\s*\/?\s*bag/i, pass: true, note: "canonical MC price" },
  { re: /\$3\.49\s*\/?\s*bag/i, pass: true, note: "canonical MC landed price" },
  { re: /\$3\.00\s*\/?\s*bag/i, pass: true, note: "canonical pallet price" },
  { re: /\$4\.99[\s–-]+\$5\.99/, pass: true, note: "canonical MSRP range" },
];

// -------------------------------------------------------------------- Checks
const issues = [];
const passes = [];

// 1. Blocked patterns
for (const b of BLOCKED) {
  if (b.re.test(bodyText)) issues.push({ gate: "BLOCKED_CLAIM", detail: b.label });
}

// 2. Required tokens
const hasRequired = REQUIRED_ANY.some((r) => r.test(bodyText));
if (!hasRequired) issues.push({ gate: "MISSING_PRODUCT_ANCHOR", detail: "No 'All American Gummy Bears' or '7.5 oz' reference — not a valid pitch" });

// 3. Dollar amounts not in canonical list
const dollarMatches = [...bodyText.matchAll(/\$(\d+(?:\.\d{2})?)/g)].map((m) => m[0]);
const allowed = ["$3.25", "$3.49", "$3.00", "$4.99", "$5.99"];
for (const d of dollarMatches) {
  if (!allowed.includes(d)) {
    issues.push({ gate: "UNAUTHORIZED_PRICE", detail: `Dollar amount ${d} is not in canonical tier {$3.25, $3.49, $3.00, $4.99, $5.99}` });
  }
}

// 4. Apollo verify (required unless explicitly skipped)
async function apolloVerify(email) {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return { status: "missing_config", note: "No APOLLO_API_KEY env var" };
  try {
    const r = await fetch("https://api.apollo.io/v1/mixed_people/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": key },
      body: JSON.stringify({
        q_keywords: email,
        page: 1,
        per_page: 5,
      }),
    });
    const j = await r.json();
    const people = [...(j.people || []), ...(j.contacts || [])];
    const p = people.find((person) => String(person.email || "").toLowerCase() === String(email).toLowerCase()) || {};
    // Verified means: a person record exists AND the specific email is unlocked AND email_status is verified
    const unlocked = p.email && !/email_not_unlocked/.test(p.email);
    const verified = p.email_status === "verified";
    return {
      status: verified && unlocked ? "verified" : "unverified",
      apollo_email: p.email,
      email_status: p.email_status,
      org: p.organization?.name,
      note: unlocked ? "unlocked" : "email locked — unlock before send",
    };
  } catch (e) {
    return { status: "error", note: e.message };
  }
}

// 5. HubSpot prior-engagement scan (required unless explicitly skipped)
async function hubspotDedup(email) {
  const tok = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!tok) return { status: "missing_config", note: "No HUBSPOT_PRIVATE_APP_TOKEN" };
  try {
    const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
        properties: ["email", "hs_lead_status", "num_conversion_events"],
        limit: 1,
      }),
    });
    const j = await r.json();
    const c = j.results?.[0];
    if (!c) return { status: "no_contact" };
    const cid = c.id;
    const rel = await fetch(`https://api.hubapi.com/crm/v4/objects/contacts/${cid}/associations/emails`, {
      headers: { Authorization: `Bearer ${tok}` },
    }).then((x) => x.json());
    const prior = (rel.results || []).length;
    return { status: prior > 0 ? "prior_engagement" : "clean", prior_count: prior, contact_id: cid, lead_status: c.properties?.hs_lead_status };
  } catch (e) {
    return { status: "error", note: e.message };
  }
}

// 6. Gmail SENT dedup (required unless explicitly skipped)
async function gmailSentDedup(email) {
  return {
    status: "missing_config",
    note: `Gmail SENT dedup requires the Gmail connector/runtime. Query required before production send: in:sent newer_than:90d (to:${email} OR from:${email})`,
  };
}

// 7. Run async gates
const asyncGates = [];
if (!args["skip-apollo"]) asyncGates.push(apolloVerify(args.email).then((r) => ({ name: "APOLLO", result: r })));
if (!args["skip-hubspot"]) asyncGates.push(hubspotDedup(args.email).then((r) => ({ name: "HUBSPOT", result: r })));
if (!args["skip-gmail"]) asyncGates.push(gmailSentDedup(args.email).then((r) => ({ name: "GMAIL", result: r })));

const asyncResults = await Promise.all(asyncGates);
for (const { name, result } of asyncResults) {
  if (name === "APOLLO" && result.status !== "verified") {
    issues.push({ gate: "APOLLO_UNVERIFIED", detail: `Email not Apollo-verified (${result.status}): ${result.note}. Apollo-returned email=${result.apollo_email || "(none)"}. DO NOT SEND.` });
  }
  if (name === "APOLLO" && result.status === "verified") {
    passes.push({ gate: "APOLLO", detail: `Verified at Apollo — org=${result.org}, email_status=${result.email_status}` });
  }
  if (name === "HUBSPOT" && result.status === "prior_engagement") {
    issues.push({ gate: "HUBSPOT_DEDUP", detail: `${result.prior_count} prior email engagements with ${args.email}. Check timeline before sending.` });
  }
  if (name === "HUBSPOT" && result.status === "error") {
    issues.push({ gate: "HUBSPOT_ERROR", detail: `HubSpot dedup errored: ${result.note}. DO NOT SEND until HubSpot timeline is checked.` });
  }
  if (name === "HUBSPOT" && result.status === "clean") {
    passes.push({ gate: "HUBSPOT", detail: `No prior engagement on HubSpot contact ${result.contact_id}` });
  }
  if (name === "HUBSPOT" && result.status === "no_contact") {
    passes.push({ gate: "HUBSPOT", detail: "No HubSpot contact exists yet" });
  }
  if (name === "HUBSPOT" && result.status === "missing_config") {
    issues.push({ gate: "HUBSPOT_CONFIG_MISSING", detail: `${result.note}. DO NOT SEND until HubSpot dedup is run or explicitly skipped for draft-only/dev.` });
  }
  if (name === "GMAIL" && result.status !== "clean") {
    issues.push({ gate: "GMAIL_SENT_DEDUP_REQUIRED", detail: `${result.note}. DO NOT SEND until Gmail SENT dedup is run or explicitly skipped for draft-only/dev.` });
  }
}

if (args["skip-apollo"]) {
  console.warn("WARNING: --skip-apollo used. This is draft-only/dev mode, not a production send pass.");
}
if (args["skip-hubspot"]) {
  console.warn("WARNING: --skip-hubspot used. This is draft-only/dev mode, not a production send pass.");
}
if (args["skip-gmail"]) {
  console.warn("WARNING: --skip-gmail used. This is draft-only/dev mode, not a production send pass.");
}

// ---------------------------------------------------------- Report
const divider = "─".repeat(70);
console.log(divider);
console.log(`OUTREACH VALIDATOR — ${args.email}`);
console.log(`Body: ${bodyPath} (${bodyText.length} chars)`);
console.log(divider);

if (passes.length) {
  console.log("✓ PASSES");
  for (const p of passes) console.log(`  [${p.gate}] ${p.detail}`);
}

if (issues.length) {
  console.log("\n✗ BLOCKS");
  for (const i of issues) console.log(`  [${i.gate}] ${i.detail}`);
  console.log(`\n${divider}\nRESULT: BLOCK — ${issues.length} gate(s) failed. Fix before sending.\n${divider}`);
  process.exit(1);
}

console.log(`\n${divider}\nRESULT: PASS — safe to send.\n${divider}`);
process.exit(0);
