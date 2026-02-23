#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import { execSync, spawnSync } from "node:child_process";

const HOME = process.env.HOME || "/Users/ben";
const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CREDS_FILE = path.join(HOME, ".config/usa-gummies-mcp/.notion-credentials");
const SEND_EMAIL_SCRIPT = path.join(PROJECT_ROOT, "scripts/send-email.sh");
const CHECK_EMAIL_SCRIPT = path.join(PROJECT_ROOT, "scripts/check-email.sh");
const INBOX_CACHE_FILE = path.join(HOME, ".config/usa-gummies-mcp/agentic-inbox-processed.json");
const INBOX_BACKFILL_CACHE_FILE = path.join(HOME, ".config/usa-gummies-mcp/agentic-inbox-backfill-processed.json");
const RUN_LEDGER_FILE = path.join(HOME, ".config/usa-gummies-mcp/agentic-run-ledger.json");
const REPLY_ATTENTION_FILE = path.join(HOME, ".config/usa-gummies-mcp/reply-attention-queue.json");
const APPROVED_SENDS_FILE = path.join(HOME, ".config/usa-gummies-mcp/reply-approved-sends.json");
const EMAIL_SEND_LOG_FILE = path.join(HOME, ".config/usa-gummies-mcp/email_send_log.md");
const KPI_TUNING_FILE = path.join(HOME, ".config/usa-gummies-mcp/agentic-kpi-tuning.json");
const DELIVERABILITY_GUARD_FILE = path.join(HOME, ".config/usa-gummies-mcp/agentic-deliverability-guard.json");
const SEND_RECONCILE_FILE = path.join(HOME, ".config/usa-gummies-mcp/agentic-send-reconcile.json");
const QUOTES_PENDING_FILE = path.join(HOME, ".config/usa-gummies-mcp/agentic-quotes-pending.json");
const REENGAGEMENT_LOG_FILE = path.join(HOME, ".config/usa-gummies-mcp/agentic-reengagement-log.json");
const TEMPLATE_PERFORMANCE_FILE = path.join(HOME, ".config/usa-gummies-mcp/agentic-template-performance.json");
const FAIRE_ORDERS_FILE = path.join(HOME, ".config/usa-gummies-mcp/agentic-faire-orders.json");
const HTTP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 15000;
const STATUS_FILE = path.join(HOME, ".config/usa-gummies-mcp/agentic-system-status.json");
const SELF_HEAL_LOCK_FILE = path.join(HOME, ".config/usa-gummies-mcp/agentic-self-heal.lock");

const SEND_POLICY = {
  b2bFloorPerDay: Number(process.env.B2B_SEND_FLOOR_PER_DAY || 35),
  b2bHardMaxPerDay: Number(process.env.B2B_SEND_HARD_MAX_PER_DAY || 60),
  distributorFloorPerDay: Number(process.env.DISTRIBUTOR_SEND_FLOOR_PER_DAY || 15),
  distributorHardMaxPerDay: Number(process.env.DISTRIBUTOR_SEND_HARD_MAX_PER_DAY || 30),
};

const KPI_GOVERNOR_POLICY = {
  floorWindowDays: 3,
  minMissDaysToEscalate: 2,
  b2bMultiplierStep: 0.15,
  distributorMultiplierStep: 0.15,
  maxMultiplier: 2.0,
  minMultiplier: 1.0,
  searchCapStep: 2,
  maxSearchCap: 20,
  minSearchCap: 6,
};

const DELIVERABILITY_POLICY = {
  domainMinBounces: 2,
  domainMinBounceRatePct: 25,
  sourceMinBounces: 3,
  sourceMinBounceRatePct: 30,
  blockTtlDays: 21,
};

const PIPELINE_POLICY = {
  b2bReadyBufferMultiple: 2,
  distributorReadyBufferMultiple: 2,
  b2bMinResearchTopUp: 12,
  distributorMinResearchTopUp: 10,
};

const SCHEDULE_PLAN = {
  agent7: { label: "Daily Performance Report", hour: 7, minute: 45, graceMinutes: 180 },
  agent1: { label: "B2B Researcher", hour: 8, minute: 0, graceMinutes: 240 },
  agent22: { label: "Distributor Reference Seeder", hour: 8, minute: 20, graceMinutes: 240 },
  agent2: { label: "Distributor Researcher", hour: 8, minute: 30, graceMinutes: 240 },
  agent12: { label: "Balanced Contact Verifier", hour: 8, minute: 40, graceMinutes: 240 },
  agent0: { label: "Email Audit", hour: 8, minute: 50, graceMinutes: 240 },
  agent19: { label: "Notion Master Sync", hour: 8, minute: 52, graceMinutes: 240 },
  agent18: { label: "No-Resend Guard", hour: 8, minute: 55, graceMinutes: 240 },
  agent20: { label: "Send Queue Gate", hour: 8, minute: 57, graceMinutes: 240 },
  agent3: { label: "B2B Sender", hour: 9, minute: 0, graceMinutes: 240 },
  agent4: { label: "Distributor Sender", hour: 9, minute: 15, graceMinutes: 240 },
  agent13: { label: "Quota Floor Enforcer", hour: 11, minute: 0, graceMinutes: 240 },
  agent21: { label: "Pipeline Pulse", hour: 15, minute: 30, graceMinutes: 300 },
  agent5: { label: "Follow-Up Agent", hour: 13, minute: 0, graceMinutes: 300 },
  agent6: { label: "Inbox Monitor", hour: 16, minute: 0, graceMinutes: 300 },
  agent8: { label: "Customer Learning", hour: 17, minute: 0, graceMinutes: 300 },
  agent9: { label: "Bounce Intelligence", hour: 17, minute: 15, graceMinutes: 300 },
  agent11: { label: "Revenue Attribution Forecast", hour: 17, minute: 30, graceMinutes: 300 },
  agent16: { label: "KPI Governor", hour: 17, minute: 45, graceMinutes: 300 },
  agent17: { label: "Deliverability SRE", hour: 18, minute: 0, graceMinutes: 300 },
  agent10: { label: "Self-Heal Monitor", intervalMinutes: 30, graceMinutes: 45 },
  agent23: { label: "Deal Progression Tracker", hour: 10, minute: 0, graceMinutes: 240 },
  agent24: { label: "Pricing & Quote Generator", hour: 10, minute: 30, graceMinutes: 240 },
  agent25: { label: "Order Fulfillment Bridge", hour: 11, minute: 30, graceMinutes: 240 },
  agent26: { label: "Win/Loss Analyzer", dayOfWeek: 1, hour: 18, minute: 0, graceMinutes: 300 },
  agent27: { label: "Re-engagement Campaigner", hour: 14, minute: 0, graceMinutes: 300 },
  agent28: { label: "Faire Order Monitor", hour: 9, minute: 30, graceMinutes: 240 },
  agent29: { label: "Template A/B Rotator", dayOfWeek: 0, hour: 19, minute: 0, graceMinutes: 300 },
  agent30: { label: "Contact Enrichment Agent", hour: 12, minute: 0, graceMinutes: 300 },
};

const IDS = {
  root: process.env.NOTION_USA_GUMMIES_ROOT_ID || "30d4c0c42c2e8100bed7d2001ad5eecf",
  b2bProspects: process.env.NOTION_DB_B2B_PROSPECTS || "6007a5df7b49468b9bbf1f1341885aea",
  distributorProspects: process.env.NOTION_DB_DISTRIBUTOR_PROSPECTS || "804b3270eb17483caac0441369c21f3a",
  runLog: process.env.NOTION_DB_AGENT_RUN_LOG || "30d4c0c42c2e81b0914ee534e56e2351",
  dailyReports: process.env.NOTION_DB_DAILY_REPORTS || "2f31cfad04b744e3b16da4edc9675502",
  repackerList: process.env.NOTION_DB_REPACKER_LIST || "cfdc95e9eab44f5480f578a1349eadd9",
  emailTemplatesPage: process.env.NOTION_PAGE_EMAIL_TEMPLATES || "30f4c0c42c2e816e8abce26b6c2693dc",
};

const B2B_TYPES = [
  "Gift Shop",
  "Retailer",
  "Sporting Goods",
  "Farm Stand",
  "Country Store",
  "Fair/Market Vendor",
  "Other",
];

const B2B_STATUS = [
  "New - Uncontacted",
  "Outreach Sent",
  "Follow-Up Sent",
  "Replied - Interested",
  "Replied - Not Interested",
  "Bounced",
  "Order Placed",
];

const DIST_STATUS = [
  "New - Uncontacted",
  "Outreach Sent",
  "Follow-Up Sent",
  "Replied - Interested",
  "Replied - Not Interested",
  "Bounced",
  "Contract Discussion",
  "Contract Signed",
];

const RUN_STATUS = ["Success", "Partial", "Failed"];

const REQUIRED_B2B_FIELDS = {
  "Business Name": { title: {} },
  "Contact Name": { rich_text: {} },
  Email: { email: {} },
  Phone: { phone_number: {} },
  City: { rich_text: {} },
  State: { rich_text: {} },
  "Business Type": { select: { options: B2B_TYPES.map((name) => ({ name })) } },
  Source: { rich_text: {} },
  Status: { select: { options: B2B_STATUS.map((name) => ({ name })) } },
  "Date First Contacted": { date: {} },
  "Date Follow-Up Sent": { date: {} },
  "Reply Received": { checkbox: {} },
  "Reply Summary": { rich_text: {} },
  "Email Copy Sent": { rich_text: {} },
  Notes: { rich_text: {} },
  "Fair.com Referred": { checkbox: {} },
  "Quote Sent": { checkbox: {} },
  "Quote Amount": { number: { format: "number" } },
  "Order Value": { number: { format: "number" } },
  "Order Date": { date: {} },
  "Shopify Order ID": { rich_text: {} },
  "Re-engagement Count": { number: { format: "number" } },
  "Template Variant": { select: { options: ["A", "B"].map((name) => ({ name })) } },
  "Last Template Used": { rich_text: {} },
};

const REQUIRED_DIST_FIELDS = {
  "Company Name": { title: {} },
  "Contact Name": { rich_text: {} },
  Email: { email: {} },
  Phone: { phone_number: {} },
  City: { rich_text: {} },
  State: { rich_text: {} },
  "Distance from Repacker": { number: { format: "number" } },
  "Nearest Repacker Location": {
    select: {
      options: ["Spokane", "Salt Lake City", "Chicago", "Philadelphia", "Orlando", "TBD"].map((name) => ({ name })),
    },
  },
  Source: { rich_text: {} },
  Status: { select: { options: DIST_STATUS.map((name) => ({ name })) } },
  "Date First Contacted": { date: {} },
  "Date Follow-Up Sent": { date: {} },
  "Reply Received": { checkbox: {} },
  "Reply Summary": { rich_text: {} },
  "Email Copy Sent": { rich_text: {} },
  Notes: { rich_text: {} },
  "Quote Sent": { checkbox: {} },
  "Contract Value": { number: { format: "number" } },
  "Faire Order ID": { rich_text: {} },
};

const REQUIRED_RUNLOG_FIELDS = {
  "Agent Name": { title: {} },
  "Run Date": { date: {} },
  "Records Processed": { number: { format: "number" } },
  "Emails Sent": { number: { format: "number" } },
  Errors: { rich_text: {} },
  Status: { select: { options: RUN_STATUS.map((name) => ({ name })) } },
  Notes: { rich_text: {} },
};

const TEMPLATE_LIBRARY = {
  b2bInitial: {
    subject: "American-Made, Dye-Free Gummy Bears — Built for Stores Like Yours",
    body: [
      "Hi [First Name],",
      "",
      "My name is Benjamin, and I'm the founder of USA Gummies — we make All American Gummy Bears that are dye-free, Made in the USA, and positioned around American pride and clean-label values.",
      "",
      "We launched because parents, health-conscious buyers, and patriotic consumers were asking for something they could actually feel good about. We've been moving 8–12 units per store per week in early retail placements, and we're growing fast.",
      "",
      "Here's why I'm reaching out to you specifically: 2026 is America 250 — the country's 250th birthday — and we believe every retailer who carries American-made products has a real opportunity this year. Beyond that, dye bans and artificial color regulations are moving quickly across multiple states. We're already ahead of that curve, and our retail partners will be too.",
      "",
      "The easiest way to try us is through our Fair.com storefront — you can place a small wholesale order, test velocity in your store, and we'll take it from there. If you'd rather go direct, our wholesale price is $3.49/bag (7.5 oz) with no minimums on first orders.",
      "",
      "Want me to send over a sell sheet and sample info?",
      "",
      "Benjamin Stutman",
      "Founder, USA Gummies",
      "[email] | [phone]",
      "Fair.com: [link]",
    ].join("\n"),
  },
  b2bFollowUp: {
    subject: "Re: American-Made Gummy Bears",
    body: [
      "Hi [First Name],",
      "",
      "Following up on my note from last week in case it got lost.",
      "",
      "We make dye-free, American-made gummy bears — 7.5 oz bags, no minimums on first orders. If you'd like to try a small test order, our Fair.com storefront makes it easy. We can also send samples first if you'd prefer.",
      "",
      "Happy to answer any questions.",
      "",
      "Benjamin Stutman",
      "Founder, USA Gummies",
      "[email] | [phone]",
    ].join("\n"),
  },
  distributorInitial: {
    subject: "Distribution Inquiry — Dye-Free, Made-in-USA Gummy Bears",
    body: [
      "Hi [First Name],",
      "",
      "My name is Benjamin Stutman. I'm the founder of USA Gummies — we manufacture All American Gummy Bears, dye-free, Made in the USA, in 7.5 oz retail bags.",
      "",
      "A few things that may be relevant to your portfolio:",
      "",
      "Dye bans and artificial color regulations are moving across multiple states. We were built from day one to be fully compliant — clean-label, no synthetic dyes, nothing to reformulate.",
      "",
      "2026 marks America's 250th anniversary. American-made products are well-positioned for that national moment, and we're purpose-built for it.",
      "",
      "We supply regionally through a repacker network, which keeps freight efficient and lead times manageable regardless of geography.",
      "",
      "If there's interest, I'm happy to send a sell sheet or discuss further. No pressure — just wanted to make the introduction.",
      "",
      "Benjamin Stutman",
      "Founder, USA Gummies",
      "[email] | [phone]",
    ].join("\n"),
  },
  distributorFollowUp: {
    subject: "Re: USA Gummies — Distribution Inquiry",
    body: [
      "Hi [First Name],",
      "",
      "Wanted to follow up on my note from last week in case it got buried.",
      "",
      "We make dye-free, American-made gummy bears — 7.5 oz retail bags, regionally supplied, no synthetic dyes. Happy to send a sell sheet or product samples if that would be useful.",
      "",
      "Let me know if it makes sense to connect.",
      "",
      "Benjamin Stutman",
      "Founder, USA Gummies",
      "[email] | [phone]",
    ].join("\n"),
  },
  b2bNudge: {
    subject: "Re: American-Made Gummy Bears — Quick Follow-Up",
    body: [
      "Hi [First Name],",
      "",
      "Wanted to circle back — I know things get busy. We spoke a bit about carrying our dye-free, Made-in-USA gummy bears, and I wanted to see if you had any questions or if there's a better time to connect.",
      "",
      "Happy to send samples or a sell sheet if that would help move things forward. No pressure at all.",
      "",
      "Benjamin Stutman",
      "Founder, USA Gummies",
      "[email] | [phone]",
    ].join("\n"),
  },
  b2bReengagement: {
    subject: "USA Gummies — Checking Back In",
    body: [
      "Hi [First Name],",
      "",
      "It's been a little while since we last connected, and I wanted to check back in. We've had some great momentum this year — new retail placements, strong sell-through, and the dye-free trend continuing to grow.",
      "",
      "If the timing wasn't right before, maybe now is a better fit. We still have no minimums on first orders, and 2026 being America's 250th birthday has been a real tailwind for our Made-in-USA positioning.",
      "",
      "Would love to reconnect if there's interest.",
      "",
      "Benjamin Stutman",
      "Founder, USA Gummies",
      "[email] | [phone]",
    ].join("\n"),
  },
  b2bQuoteAttached: {
    subject: "USA Gummies — Your Wholesale Quote",
    body: [
      "Hi [First Name],",
      "",
      "Thanks for your interest in carrying USA Gummies! Here's the pricing breakdown we discussed:",
      "",
      "[Quote Details]",
      "",
      "Quick highlights:",
      "- All American Gummy Bears, 7.5 oz bags",
      "- Dye-free, Made in the USA",
      "- Suggested retail: $5.99–$6.99",
      "- No minimums on first orders",
      "",
      "Let me know if you have any questions or want to place a trial order. We can also ship through Fair.com for easy wholesale ordering.",
      "",
      "Benjamin Stutman",
      "Founder, USA Gummies",
      "[email] | [phone]",
    ].join("\n"),
  },
  distributorNudge: {
    subject: "Re: USA Gummies — Distribution Partnership",
    body: [
      "Hi [First Name],",
      "",
      "Following up on our earlier conversation about distribution. We've been adding retail partners steadily and the dye-free category continues to gain momentum with state-level regulations driving consumer demand.",
      "",
      "If you're evaluating new brands for your portfolio, I'd love to share updated sell-through data and our repacker network coverage. Happy to jump on a quick call whenever works.",
      "",
      "Benjamin Stutman",
      "Founder, USA Gummies",
      "[email] | [phone]",
    ].join("\n"),
  },
};

const RESEARCH_PARAMS = {
  b2bBusinessDefinition:
    "Independent retail businesses likely to place wholesale candy orders: gift shops, country stores, farm stands, sporting goods independents, toy stores, candy boutiques, and similar non-chain retailers.",
  distributorDefinition:
    "Regional/national B2B distributors and wholesalers that supply convenience, grocery, specialty, or foodservice accounts (not consumer-only brands, directories, or marketplaces).",
  b2bQueries: [
    { q: "independent gift shop usa contact email", type: "Gift Shop" },
    { q: "americana retail store usa contact email", type: "Retailer" },
    { q: "country store usa about us email", type: "Country Store" },
    { q: "farm stand market usa contact email", type: "Farm Stand" },
    { q: "independent sporting goods store usa contact email", type: "Sporting Goods" },
    { q: "independent toy store usa contact email", type: "Retailer" },
    { q: "candy boutique usa contact email", type: "Other" },
  ],
  distributorQueryTemplates: [
    "food distributor {city} {state} contact email",
    "candy distributor {city} {state} contact email",
    "snack distributor {city} {state} sales email",
    "confectionery wholesaler {city} {state} contact email",
    "independent distributor {city} {state} line card email",
  ],
  distributorReferenceNames: ["Inderbitzin", "KeHE", "UNFI", "C&S", "Core-Mark"],
  distributorNationalQueryTemplates: [
    "independent candy distributor {state} contact email",
    "confectionery distributor {state} sales email",
    "foodservice snack distributor {state} contact email",
    "specialty food wholesaler {state} contact email",
  ],
  nationalFocusStates: ["CA", "TX", "FL", "NY", "PA", "IL", "OH", "NC", "GA", "AZ", "WA", "CO", "MI", "TN"],
  blockedHosts: [
    "yelp.com",
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "tripadvisor.com",
    "wikipedia.org",
    "mapquest.com",
    "yellowpages.com",
    "bbb.org",
    "zoominfo.com",
    "dnb.com",
    "opencorporates.com",
    "chamberofcommerce.com",
    "manta.com",
    "superpages.com",
  ],
  b2bIncludeKeywords: ["gift", "shop", "store", "retail", "boutique", "farm", "country", "sporting", "toy", "candy"],
  b2bSmallStoreSignals: [
    "independent",
    "family owned",
    "family-owned",
    "small business",
    "local shop",
    "general store",
    "country store",
    "gift shop",
    "farm market",
    "farm stand",
    "toy store",
    "candy shop",
    "boutique",
    "mercantile",
  ],
  b2bChainSignals: [
    "walmart",
    "target",
    "costco",
    "sam's club",
    "walgreens",
    "cvs",
    "kroger",
    "safeway",
    "7-eleven",
    "dollar general",
    "dollar tree",
    "whole foods",
    "trader joe",
    "corporate office",
    "franchise opportunity",
  ],
  b2bLowIntentSignals: ["directory", "top 10", "list of", "marketplace", "jobs", "career", "franchise opportunities"],
  b2bMinFitScore: 1,
  distributorIncludeKeywords: [
    "distributor",
    "distribution",
    "wholesale",
    "wholesaler",
    "foodservice",
    "confectionery",
    "snack",
    "grocery",
    "convenience",
    "c-store",
    "line card",
    "brands we carry",
  ],
  distributorStrongSignals: [
    "distributor",
    "distribution",
    "wholesale",
    "wholesaler",
    "foodservice",
    "convenience",
    "grocery",
    "c-store",
    "candy",
    "confectionery",
    "snack",
  ],
  distributorPreferredSignals: [
    "independent distributor",
    "regional distributor",
    "family owned",
    "sales team",
    "territory",
    "warehouse",
    "line card",
    "brands we carry",
  ],
  distributorNegativeSignals: [
    "consumer brand",
    "ecommerce only",
    "dropship",
    "list of distributors",
    "manufacturer only",
    "broker only",
    "consulting only",
    "directory",
  ],
  distributorMinFitScore: 2,
  badEmailLocals: ["no-reply", "noreply", "donotreply", "support", "help", "privacy", "legal", "abuse", "webmaster"],
  freemailDomains: ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com", "proton.me", "protonmail.com"],
};

const ADAPTIVE_PARAMS = {
  b2bMaxAdaptiveQueries: 30,
  distributorMaxAdaptiveQueries: 36,
  distributorMaxAdaptiveStates: 6,
  b2bRepackerCityLimit: 6,
  distributorNationalExpansionStates: 10,
  b2bMaxSearchCallsPerRun: 8,
  distributorMaxSearchCallsPerRun: 16,
  smoothingAlpha: 1,
  smoothingBeta: 2,
  defaultStates: ["CA", "TX", "FL", "NY", "PA", "IL", "OH", "NC", "GA", "AZ"],
  b2bReachedStatuses: ["Outreach Sent", "Follow-Up Sent", "Replied - Interested", "Replied - Not Interested", "Order Placed"],
  b2bInterestedStatuses: ["Replied - Interested", "Order Placed"],
  distributorReachedStatuses: ["Outreach Sent", "Follow-Up Sent", "Replied - Interested", "Replied - Not Interested", "Contract Discussion", "Contract Signed"],
  distributorInterestedStatuses: ["Replied - Interested", "Contract Discussion", "Contract Signed"],
};

const B2B_TYPE_SEARCH_SEEDS = {
  "Gift Shop": ["independent gift shop", "gift boutique"],
  Retailer: ["independent retail store", "americana retail store"],
  "Sporting Goods": ["independent sporting goods store", "outdoor sporting goods shop"],
  "Farm Stand": ["farm stand market", "country farm market"],
  "Country Store": ["country store", "general store"],
  "Fair/Market Vendor": ["artisan market vendor", "fair market vendor"],
  Other: ["candy boutique", "specialty candy store"],
};

const REPACKER_ANCHOR_HUBS = [
  { name: "Spokane", city: "Spokane", state: "WA" },
  { name: "Salt Lake City", city: "Salt Lake City", state: "UT" },
  { name: "Chicago", city: "Chicago", state: "IL" },
  { name: "Philadelphia", city: "Philadelphia", state: "PA" },
  { name: "Orlando", city: "Orlando", state: "FL" },
];

// Emails blocked from all further automated outreach (initial cold email may have already been sent).
// These prospects should be handled manually by Ben if needed.
const BLOCKED_OUTREACH_EMAILS = new Set([
  "jennyi@inderbitzin.com",  // Inderbitzin Distributors — no further automated contact
]);

const DISTRIBUTOR_REFERENCE_SEEDS = [
  { company: "Inderbitzin Distributors", email: "jennyi@inderbitzin.com", city: "Nampa", state: "ID", source: "reference-seed" },
  { company: "KeHE Distributors", email: "contactus@kehe.com", city: "Naperville", state: "IL", source: "reference-seed" },
  { company: "KeHE Distributors", email: "b.barnholt@kehe.com", city: "Naperville", state: "IL", source: "reference-seed" },
  { company: "UNFI", email: "info@unfi.com", city: "Providence", state: "RI", source: "reference-seed" },
  { company: "Core-Mark", email: "tloving@core-mark.com", city: "Westlake", state: "TX", source: "reference-seed" },
];

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
]);

const US_STATE_NAME_TO_CODE = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN",
  texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

let notionKey = "";
let dbSchemas = {};

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function normalizeRunStatus(statusValue) {
  const raw = String(statusValue || "").trim().toLowerCase();
  if (raw === "partial") return "partial";
  if (raw === "failed" || raw === "failure" || raw === "error") return "failed";
  return "success";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function promiseWithTimeout(promise, timeoutMs, fallbackValue = null) {
  const timeout = Math.max(1000, Number(timeoutMs || 0));
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallbackValue), timeout);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function etParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = Number(get("hour") || "0");
  const minute = Number(get("minute") || "0");
  const second = Number(get("second") || "0");
  const weekday = get("weekday");
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday,
    date: `${year}-${month}-${day}`,
    minutesOfDay: hour * 60 + minute,
  };
}

function defaultStatusModel() {
  const seededAgents = Object.fromEntries(
    Object.entries(SCHEDULE_PLAN).map(([key, schedule]) => [
      key,
      { key, label: schedule.label, lastStatus: "never" },
    ])
  );
  return {
    timezone: "America/New_York",
    updatedAt: new Date().toISOString(),
    updatedAtET: `${todayET()} 00:00:00`,
    heartbeat: {
      lastSeenAt: new Date().toISOString(),
      source: "bootstrap",
    },
    schedule: SCHEDULE_PLAN,
    agents: seededAgents,
    recentEvents: [],
    selfHeal: {
      lastRunAt: "",
      lastActionSummary: "",
      actions: [],
    },
  };
}

function loadSystemStatus() {
  try {
    if (!fs.existsSync(STATUS_FILE)) return defaultStatusModel();
    const raw = fs.readFileSync(STATUS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const base = defaultStatusModel();
    return {
      ...base,
      ...parsed,
      schedule: SCHEDULE_PLAN,
      agents: {
        ...(base.agents || {}),
        ...(parsed?.agents || {}),
      },
      recentEvents: Array.isArray(parsed?.recentEvents) ? parsed.recentEvents : [],
      selfHeal: {
        ...base.selfHeal,
        ...(parsed?.selfHeal || {}),
      },
    };
  } catch {
    return defaultStatusModel();
  }
}

function saveSystemStatus(status) {
  const now = new Date();
  const et = etParts(now);
  const next = {
    ...status,
    updatedAt: now.toISOString(),
    updatedAtET: `${et.date} ${String(et.hour).padStart(2, "0")}:${String(et.minute).padStart(2, "0")}:${String(et.second).padStart(2, "0")}`,
    heartbeat: {
      ...(status.heartbeat || {}),
      lastSeenAt: now.toISOString(),
      source: status?.heartbeat?.source || "agent-runtime",
    },
    schedule: SCHEDULE_PLAN,
  };
  fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
  fs.writeFileSync(STATUS_FILE, JSON.stringify(next, null, 2), "utf8");
}

function appendStatusEvent(status, event) {
  const events = Array.isArray(status.recentEvents) ? status.recentEvents : [];
  events.push(event);
  status.recentEvents = events.slice(-80);
}

function updateAgentStatus(agentKey, payload) {
  const status = loadSystemStatus();
  const now = new Date();
  const et = etParts(now);
  const existing = status.agents?.[agentKey] || {};
  const nextAgent = {
    ...existing,
    key: agentKey,
    label: SCHEDULE_PLAN[agentKey]?.label || existing.label || agentKey,
    lastRunAt: now.toISOString(),
    lastRunAtET: `${et.date} ${String(et.hour).padStart(2, "0")}:${String(et.minute).padStart(2, "0")}:${String(et.second).padStart(2, "0")}`,
    lastRunDateET: et.date,
    ...payload,
  };
  status.agents = status.agents || {};
  status.agents[agentKey] = nextAgent;
  appendStatusEvent(status, {
    at: now.toISOString(),
    agent: agentKey,
    status: payload.lastStatus || "unknown",
    summary: payload.summary || "",
  });
  saveSystemStatus(status);
}

function tryAcquireSelfHealLock(maxAgeMs = 45 * 60 * 1000) {
  try {
    if (fs.existsSync(SELF_HEAL_LOCK_FILE)) {
      const stat = fs.statSync(SELF_HEAL_LOCK_FILE);
      const age = Date.now() - stat.mtimeMs;
      if (age < maxAgeMs) return false;
    }
    fs.mkdirSync(path.dirname(SELF_HEAL_LOCK_FILE), { recursive: true });
    fs.writeFileSync(SELF_HEAL_LOCK_FILE, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), "utf8");
    return true;
  } catch {
    return false;
  }
}

function releaseSelfHealLock() {
  try {
    if (fs.existsSync(SELF_HEAL_LOCK_FILE)) fs.unlinkSync(SELF_HEAL_LOCK_FILE);
  } catch {
    // ignore
  }
}

function toNotionId(id) {
  return (id || "").replace(/-/g, "");
}

function readNotionKey() {
  if (!fs.existsSync(CREDS_FILE)) {
    throw new Error(`Notion credentials file not found: ${CREDS_FILE}`);
  }
  const raw = fs.readFileSync(CREDS_FILE, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (t.startsWith("NOTION_API_KEY=")) {
      notionKey = t.slice("NOTION_API_KEY=".length).trim();
      break;
    }
  }
  if (!notionKey) throw new Error("NOTION_API_KEY missing from .notion-credentials");
}

async function notion(pathname, method = "GET", body = null) {
  const res = await fetchWithTimeout(`https://api.notion.com/v1${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionKey}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  }, 20000);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${pathname} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

function richTextValue(text) {
  if (!text) return [];
  return [{ type: "text", text: { content: String(text).slice(0, 2000) } }];
}

function blockParagraph(text) {
  return { object: "block", type: "paragraph", paragraph: { rich_text: richTextValue(text) } };
}

function blockHeading(text) {
  return { object: "block", type: "heading_2", heading_2: { rich_text: richTextValue(text) } };
}

function stripEmojiPrefix(title) {
  return String(title || "").replace(/^[^A-Za-z0-9\[]+/, "").trim();
}

function getPlainText(prop) {
  if (!prop) return "";
  if (prop.type === "title") return (prop.title || []).map((x) => x.plain_text || "").join("");
  if (prop.type === "rich_text") return (prop.rich_text || []).map((x) => x.plain_text || "").join("");
  if (prop.type === "email") return prop.email || "";
  if (prop.type === "phone_number") return prop.phone_number || "";
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "url") return prop.url || "";
  if (prop.type === "date") return prop.date?.start || "";
  if (prop.type === "checkbox") return prop.checkbox ? "true" : "false";
  return "";
}

function getPropByName(page, ...names) {
  for (const name of names) {
    if (page.properties?.[name]) return page.properties[name];
  }
  return null;
}

function getFirstName(fullName) {
  const cleaned = String(fullName || "").trim();
  if (!cleaned) return "there";
  return cleaned.split(/\s+/)[0];
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function sendTouchedStatuses(isDistributor = false) {
  return new Set(
    isDistributor
      ? ["Outreach Sent", "Follow-Up Sent", "Replied - Interested", "Replied - Not Interested", "Bounced", "Contract Discussion", "Contract Signed"]
      : ["Outreach Sent", "Follow-Up Sent", "Replied - Interested", "Replied - Not Interested", "Bounced", "Order Placed"]
  );
}

function hasSendEvidence(row) {
  const firstContacted = getPlainText(getPropByName(row, "Date First Contacted"));
  const emailCopy = getPlainText(getPropByName(row, "Email Copy Sent"));
  return Boolean(String(firstContacted || "").trim() || String(emailCopy || "").trim());
}

function appendTaggedNote(existingNotes, tag, line) {
  const marker = `[${tag}]`;
  const base = String(existingNotes || "").trim();
  if (base.includes(marker)) return { text: base, added: false };
  return {
    text: `${base}\n${marker} ${line}`.trim(),
    added: true,
  };
}

function extractFirstEmail(text) {
  const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return normalizeEmail(match?.[0] || "");
}

function loadRecentSentEmailSet(maxAgeDays = 180) {
  const out = new Set();
  try {
    if (!fs.existsSync(EMAIL_SEND_LOG_FILE)) return out;
    const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const lines = fs.readFileSync(EMAIL_SEND_LOG_FILE, "utf8").split("\n");
    for (const line of lines) {
      const parts = line.split("|").map((x) => x.trim());
      if (parts.length < 3) continue;
      const ts = Date.parse(parts[0]);
      const status = parts[1];
      const toRaw = parts[2];
      if (status !== "SENT") continue;
      if (Number.isFinite(ts) && ts < cutoffMs) continue;
      const email = extractFirstEmail(toRaw);
      if (email) out.add(email);
    }
  } catch {
    return out;
  }
  return out;
}

function buildNoResendDecision({ status, dateFirstContacted, emailCopySent, email, sentHistory }) {
  const reasons = [];
  if (status && status !== "New - Uncontacted") reasons.push("status_not_new");
  if (String(dateFirstContacted || "").trim()) reasons.push("date_first_contacted_present");
  if (String(emailCopySent || "").trim()) reasons.push("email_copy_present");
  if (email && sentHistory?.has(normalizeEmail(email))) reasons.push("send_log_recent");
  return {
    blocked: reasons.length > 0,
    reasons,
    shouldPromoteToOutreach:
      reasons.includes("date_first_contacted_present") ||
      reasons.includes("email_copy_present") ||
      reasons.includes("send_log_recent"),
  };
}

function todayET() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

function todayLongET() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
}

function nowETTimestamp() {
  const et = etParts(new Date());
  return `${et.date} ${String(et.hour).padStart(2, "0")}:${String(et.minute).padStart(2, "0")}:${String(et.second).padStart(2, "0")}`;
}

function safeJsonRead(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function safeJsonWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function loadRunLedger() {
  const value = safeJsonRead(RUN_LEDGER_FILE, []);
  return Array.isArray(value) ? value : [];
}

function appendRunLedger(entry) {
  const ledger = loadRunLedger();
  ledger.push(entry);
  safeJsonWrite(RUN_LEDGER_FILE, ledger.slice(-5000));
}

function loadSendReconcileQueue() {
  const value = safeJsonRead(SEND_RECONCILE_FILE, []);
  return Array.isArray(value) ? value : [];
}

function saveSendReconcileQueue(items) {
  safeJsonWrite(SEND_RECONCILE_FILE, items.slice(-4000));
}

function queueSendReconcile(item) {
  const queue = loadSendReconcileQueue();
  const queueId = `sendsync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  queue.push({
    queueId,
    queuedAt: new Date().toISOString(),
    queuedAtET: nowETTimestamp(),
    status: "pending",
    attempts: 0,
    ...item,
  });
  saveSendReconcileQueue(queue);
  return queueId;
}

async function reconcilePendingSendCommits(limit = 200) {
  const queue = loadSendReconcileQueue();
  if (!queue.length) {
    return {
      pendingBefore: 0,
      resolvedNow: 0,
      failedNow: 0,
      stillPending: 0,
    };
  }

  let resolvedNow = 0;
  let failedNow = 0;
  let inspected = 0;

  for (const item of queue) {
    if (inspected >= limit) break;
    if (item.status === "resolved") continue;
    inspected += 1;
    try {
      const dbId = item.dbId;
      const pageId = item.pageId;
      if (!dbId || !pageId || !item.values || typeof item.values !== "object") {
        item.status = "failed";
        item.lastError = "invalid_reconcile_payload";
        item.lastAttemptAtET = nowETTimestamp();
        failedNow += 1;
        continue;
      }
      await updatePage(pageId, buildProperties(dbId, item.values));
      item.status = "resolved";
      item.resolvedAt = new Date().toISOString();
      item.resolvedAtET = nowETTimestamp();
      item.lastError = "";
      resolvedNow += 1;
    } catch (err) {
      item.attempts = Number(item.attempts || 0) + 1;
      item.lastAttemptAt = new Date().toISOString();
      item.lastAttemptAtET = nowETTimestamp();
      item.lastError = String(err?.message || err).slice(0, 200);
      if (item.attempts >= 5) {
        item.status = "failed";
        failedNow += 1;
      } else {
        item.status = "pending";
      }
    }
  }

  saveSendReconcileQueue(queue);
  const stillPending = queue.filter((x) => x.status === "pending").length;
  return {
    pendingBefore: queue.length,
    resolvedNow,
    failedNow,
    stillPending,
  };
}

function sumAgentSendsForDate(agentKey, runDateET = todayET()) {
  return loadRunLedger()
    .filter((x) => x?.runDateET === runDateET && x?.agent === agentKey && (x?.status === "success" || x?.status === "partial"))
    .reduce((sum, x) => sum + Number(x?.result?.sent || 0), 0);
}

function isHardVerificationFailure(reason) {
  return ["invalid_format", "missing_domain", "no_mx_or_dns"].includes(String(reason || ""));
}

function loadReplyAttentionQueue() {
  const value = safeJsonRead(REPLY_ATTENTION_FILE, []);
  return Array.isArray(value) ? value : [];
}

function saveReplyAttentionQueue(items) {
  safeJsonWrite(REPLY_ATTENTION_FILE, items.slice(-1000));
}

function queueReplyAttention(item) {
  const list = loadReplyAttentionQueue();
  const duplicate = list.find((x) => x.messageId === item.messageId || (x.senderEmail === item.senderEmail && x.subject === item.subject && x.receivedAtET === item.receivedAtET));
  if (duplicate) return duplicate.queueId;
  const queueId = `reply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  list.push({ queueId, status: "pending", authorizationRequired: true, ...item });
  saveReplyAttentionQueue(list);
  return queueId;
}

function defaultKpiTuningModel() {
  return {
    version: 1,
    updatedAt: "",
    updatedAtET: "",
    b2bResearchMultiplier: 1,
    distributorResearchMultiplier: 1,
    b2bSearchCallsCap: ADAPTIVE_PARAMS.b2bMaxSearchCallsPerRun,
    distributorSearchCallsCap: ADAPTIVE_PARAMS.distributorMaxSearchCallsPerRun,
    changeNotes: [],
  };
}

function loadKpiTuning() {
  const parsed = safeJsonRead(KPI_TUNING_FILE, null);
  return {
    ...defaultKpiTuningModel(),
    ...(parsed && typeof parsed === "object" ? parsed : {}),
    changeNotes: Array.isArray(parsed?.changeNotes) ? parsed.changeNotes.slice(-80) : [],
  };
}

function saveKpiTuning(next) {
  const payload = {
    ...defaultKpiTuningModel(),
    ...(next || {}),
    updatedAt: new Date().toISOString(),
    updatedAtET: nowETTimestamp(),
    changeNotes: Array.isArray(next?.changeNotes) ? next.changeNotes.slice(-80) : [],
  };
  safeJsonWrite(KPI_TUNING_FILE, payload);
  return payload;
}

function defaultDeliverabilityGuard() {
  return {
    version: 1,
    updatedAt: "",
    updatedAtET: "",
    blockedDomains: {},
    blockedSources: {},
  };
}

function addDaysToDate(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const et = etParts(d);
  return et.date;
}

function loadDeliverabilityGuard() {
  const parsed = safeJsonRead(DELIVERABILITY_GUARD_FILE, null);
  const merged = {
    ...defaultDeliverabilityGuard(),
    ...(parsed && typeof parsed === "object" ? parsed : {}),
    blockedDomains: parsed?.blockedDomains && typeof parsed.blockedDomains === "object" ? parsed.blockedDomains : {},
    blockedSources: parsed?.blockedSources && typeof parsed.blockedSources === "object" ? parsed.blockedSources : {},
  };

  const today = todayET();
  for (const [domain, meta] of Object.entries(merged.blockedDomains)) {
    if (meta?.expiresOn && meta.expiresOn < today) delete merged.blockedDomains[domain];
  }
  for (const [source, meta] of Object.entries(merged.blockedSources)) {
    if (meta?.expiresOn && meta.expiresOn < today) delete merged.blockedSources[source];
  }
  return merged;
}

function saveDeliverabilityGuard(next) {
  const payload = {
    ...defaultDeliverabilityGuard(),
    ...(next || {}),
    updatedAt: new Date().toISOString(),
    updatedAtET: nowETTimestamp(),
  };
  safeJsonWrite(DELIVERABILITY_GUARD_FILE, payload);
  return payload;
}

function isDomainBlockedByDeliverability(domain, guard = null) {
  const d = stripWww(String(domain || "").toLowerCase());
  if (!d) return false;
  const state = guard || loadDeliverabilityGuard();
  return Boolean(state.blockedDomains?.[d]);
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const source = new Date(`${dateStr}T00:00:00Z`).getTime();
  const now = new Date(`${todayET()}T00:00:00Z`).getTime();
  return Math.floor((now - source) / (24 * 3600 * 1000));
}

async function getDatabase(dbId) {
  return notion(`/databases/${toNotionId(dbId)}`);
}

async function queryDatabaseAll(dbId, filter = null, sorts = null) {
  const out = [];
  let startCursor = null;
  do {
    const body = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    const res = await notion(`/databases/${toNotionId(dbId)}/query`, "POST", body);
    out.push(...(res.results || []));
    startCursor = res.has_more ? res.next_cursor : null;
  } while (startCursor);
  return out;
}

async function getPage(pageId) {
  return notion(`/pages/${toNotionId(pageId)}`);
}

async function updatePage(pageId, properties) {
  return notion(`/pages/${toNotionId(pageId)}`, "PATCH", { properties });
}

async function createPageInDb(dbId, properties, children = []) {
  return notion("/pages", "POST", {
    parent: { database_id: toNotionId(dbId) },
    properties,
    children,
  });
}

async function appendChildren(blockId, children) {
  for (let i = 0; i < children.length; i += 100) {
    await notion(`/blocks/${toNotionId(blockId)}/children`, "PATCH", { children: children.slice(i, i + 100) });
  }
}

async function listBlockChildren(blockId) {
  const out = [];
  let cursor = null;
  do {
    const qs = cursor ? `?page_size=100&start_cursor=${cursor}` : "?page_size=100";
    const res = await notion(`/blocks/${toNotionId(blockId)}/children${qs}`);
    out.push(...(res.results || []));
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return out;
}

async function ensureFields(dbId, requiredFields) {
  const db = await getDatabase(dbId);
  const current = db.properties || {};
  const patch = {};

  if (dbId === IDS.runLog && current.Name && !current["Agent Name"]) {
    patch.Name = { name: "Agent Name" };
  }

  for (const [name, def] of Object.entries(requiredFields)) {
    if (!current[name]) patch[name] = def;
  }

  if (Object.keys(patch).length > 0) {
    await notion(`/databases/${toNotionId(dbId)}`, "PATCH", { properties: patch });
  }

  const refreshed = await getDatabase(dbId);
  dbSchemas[dbId] = Object.fromEntries(Object.entries(refreshed.properties || {}).map(([k, v]) => [k, v.type]));
  return Object.keys(patch);
}

function encodeProperty(type, value) {
  if (value === undefined) return undefined;
  if (type === "title") return { title: richTextValue(value) };
  if (type === "rich_text") return { rich_text: richTextValue(value) };
  if (type === "email") return { email: value ? String(value) : null };
  if (type === "phone_number") return { phone_number: value ? String(value) : null };
  if (type === "url") return { url: value ? String(value) : null };
  if (type === "number") return { number: value === null || value === "" || Number.isNaN(Number(value)) ? null : Number(value) };
  if (type === "date") return { date: value ? { start: String(value) } : null };
  if (type === "checkbox") return { checkbox: Boolean(value) };
  if (type === "select") return { select: value ? { name: String(value) } : null };
  return undefined;
}

function buildProperties(dbId, values) {
  const schema = dbSchemas[dbId] || {};
  const props = {};
  for (const [key, value] of Object.entries(values)) {
    if (!schema[key]) continue;
    const encoded = encodeProperty(schema[key], value);
    if (encoded !== undefined) props[key] = encoded;
  }
  return props;
}

async function logRun({ agentName, recordsProcessed = 0, emailsSent = 0, errors = "", status = "Success", notes = "" }) {
  const runDate = todayET();
  const props = buildProperties(IDS.runLog, {
    "Agent Name": agentName,
    "Run Date": runDate,
    "Records Processed": recordsProcessed,
    "Emails Sent": emailsSent,
    Errors: errors,
    Status: status,
    Notes: notes,
  });
  if (!props["Agent Name"] && dbSchemas[IDS.runLog]?.Name === "title") {
    props.Name = { title: richTextValue(agentName) };
  }
  if (!props["Run Date"] && dbSchemas[IDS.runLog]?.Timestamp === "date") {
    props.Timestamp = { date: { start: runDate } };
  }
  if (!props.Status && dbSchemas[IDS.runLog]?.Status === "select") {
    props.Status = { select: { name: status } };
  }
  if (!props.Notes && dbSchemas[IDS.runLog]?.Details === "rich_text") {
    props.Details = { rich_text: richTextValue(notes || errors || "") };
  }
  await createPageInDb(IDS.runLog, props);
}

async function ensureTemplateLibrary() {
  const blocks = await listBlockChildren(IDS.emailTemplatesPage);
  const text = blocks
    .map((b) => {
      const rt =
        b.paragraph?.rich_text ||
        b.heading_1?.rich_text ||
        b.heading_2?.rich_text ||
        b.heading_3?.rich_text ||
        b.bulleted_list_item?.rich_text ||
        [];
      return rt.map((t) => t.plain_text || "").join("");
    })
    .join("\n");

  const needles = [
    TEMPLATE_LIBRARY.b2bInitial.subject,
    TEMPLATE_LIBRARY.b2bFollowUp.subject,
    TEMPLATE_LIBRARY.distributorInitial.subject,
    TEMPLATE_LIBRARY.distributorFollowUp.subject,
  ];

  if (needles.every((n) => text.includes(n))) return false;

  const newBlocks = [
    { object: "block", type: "divider", divider: {} },
    blockHeading("[B2B Initial Outreach Template]"),
    ...TEMPLATE_LIBRARY.b2bInitial.body.split("\n").map((line) => blockParagraph(line)),
    { object: "block", type: "divider", divider: {} },
    blockHeading("[B2B Follow-Up Template]"),
    ...TEMPLATE_LIBRARY.b2bFollowUp.body.split("\n").map((line) => blockParagraph(line)),
    { object: "block", type: "divider", divider: {} },
    blockHeading("[Distributor Initial Outreach Template]"),
    ...TEMPLATE_LIBRARY.distributorInitial.body.split("\n").map((line) => blockParagraph(line)),
    { object: "block", type: "divider", divider: {} },
    blockHeading("[Distributor Follow-Up Template]"),
    ...TEMPLATE_LIBRARY.distributorFollowUp.body.split("\n").map((line) => blockParagraph(line)),
  ];

  await appendChildren(IDS.emailTemplatesPage, newBlocks);
  return true;
}

async function ensureSchemasAndTemplates() {
  readNotionKey();
  const root = await notion(`/pages/${toNotionId(IDS.root)}`);
  if (root.object !== "page") throw new Error("USA Gummies root page inaccessible.");

  const addedB2B = await ensureFields(IDS.b2bProspects, REQUIRED_B2B_FIELDS);
  const addedDist = await ensureFields(IDS.distributorProspects, REQUIRED_DIST_FIELDS);
  const addedRun = await ensureFields(IDS.runLog, REQUIRED_RUNLOG_FIELDS);
  await ensureFields(IDS.dailyReports, { Name: { title: {} } });

  const templatePatched = await ensureTemplateLibrary();

  return {
    addedB2B,
    addedDist,
    addedRun,
    templatePatched,
  };
}

function parseSearchResults(html) {
  const results = [];
  const regex = /<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gims;
  const seen = new Set();
  let match;
  while ((match = regex.exec(html))) {
    const href = decodeURIComponent(match[1] || "").replace(/&amp;/g, "&");
    const title = (match[2] || "").replace(/<[^>]+>/g, "").trim();
    if (!href || !title) continue;
    const loweredHref = href.toLowerCase();
    const loweredTitle = title.toLowerCase();
    if (loweredHref.includes("/y.js")) continue;
    if (loweredHref.startsWith("#")) continue;
    if (loweredTitle === "next" || loweredTitle === "previous") continue;
    if (loweredHref.startsWith("javascript:")) continue;
    if (loweredHref.includes("duckduckgo.com/") && !loweredHref.includes("uddg=")) continue;
    const dedupeKey = `${loweredHref}|${loweredTitle}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    results.push({ title, url: href });
  }
  return results;
}

function parseBingResults(html) {
  const results = [];
  const seen = new Set();
  const blockRegex = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/gim;
  let block;
  while ((block = blockRegex.exec(html))) {
    const chunk = block[1] || "";
    const linkMatch = chunk.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const href = decodeURIComponent(String(linkMatch[1] || "").replace(/&amp;/g, "&"));
    const title = String(linkMatch[2] || "").replace(/<[^>]+>/g, "").trim();
    if (!href || !title) continue;
    const key = `${href.toLowerCase()}|${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ title, url: href });
  }
  return results;
}

function parseYahooResults(html) {
  const results = [];
  const seen = new Set();
  const linkRegex = /(<a[^>]*href="([^"]*r\.search\.yahoo\.com[^"]*)"[^>]*>)([\s\S]*?)<\/a>/gim;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(html))) {
    const anchorOpen = String(linkMatch[1] || "");
    if (!/target="_blank"/i.test(anchorOpen)) continue;
    if (!/referrerpolicy="origin"/i.test(anchorOpen)) continue;
    const href = decodeURIComponent(String(linkMatch[2] || "").replace(/&amp;/g, "&"));
    const title = String(linkMatch[3] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!href || !title) continue;
    if (title.length < 8) continue;
    if (/^next$|^previous$/i.test(title)) continue;

    let snippet = "";
    try {
      const liStart = html.lastIndexOf("<li", linkMatch.index);
      const liEnd = html.indexOf("</li>", linkMatch.index);
      if (liStart >= 0 && liEnd > liStart) {
        const block = html.slice(liStart, liEnd);
        snippet = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 800);
      }
    } catch {
      snippet = "";
    }
    const key = `${href.toLowerCase()}|${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ title, url: href, snippet });
  }
  return results;
}

async function searchWeb(query, maxResults = 12) {
  const providers = [
    { name: "yahoo", url: `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`, parser: parseYahooResults },
    { name: "ddg-lite", url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}&kl=us-en`, parser: parseSearchResults },
    { name: "ddg-html", url: `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`, parser: parseSearchResults },
    { name: "bing", url: `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-us`, parser: parseBingResults },
    { name: "brave", url: `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`, parser: parseSearchResults },
  ];
  for (const provider of providers) {
    try {
      const res = await fetchWithTimeout(provider.url, {
        headers: {
          "User-Agent": HTTP_USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9",
        },
      }, 12000);
      if (!res.ok) continue;
      const html = await res.text();
      const parsed = provider.parser(html);
      if (parsed.length > 0) return parsed.slice(0, maxResults);
    } catch {
      // continue to next endpoint
    }
  }
  return [];
}

function cleanupUrl(raw) {
  try {
    let normalized = raw;
    if (normalized.startsWith("//")) normalized = `https:${normalized}`;
    const u = new URL(normalized);
    if (u.hostname.includes("search.yahoo.com")) {
      if (u.hostname.includes("r.search.yahoo.com")) {
        const ruIdx = u.pathname.indexOf("/RU=");
        if (ruIdx >= 0) {
          const rkIdx = u.pathname.indexOf("/RK=", ruIdx);
          const rawTarget = u.pathname.slice(ruIdx + 4, rkIdx > ruIdx ? rkIdx : undefined);
          if (rawTarget) {
            const decodedTarget = rawTarget.startsWith("http") ? rawTarget : decodeURIComponent(rawTarget);
            return cleanupUrl(decodedTarget);
          }
        }
        const byParam = u.searchParams.get("RU");
        if (byParam) return cleanupUrl(decodeURIComponent(byParam));
      }
      return null;
    }
    if (u.hostname.includes("duckduckgo.com") && u.pathname.startsWith("/l/")) {
      const target = u.searchParams.get("uddg");
      if (target) return cleanupUrl(decodeURIComponent(target));
      return null;
    }
    if (u.hostname.includes("bing.com") && u.pathname.startsWith("/ck/")) {
      const target = u.searchParams.get("u");
      if (target && target.startsWith("a1")) {
        const decoded = Buffer.from(target.slice(2), "base64").toString("utf8");
        if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
          return cleanupUrl(decoded);
        }
      }
      return null;
    }
    if (!["http:", "https:"].includes(u.protocol)) return null;
    return `${u.protocol}//${u.hostname}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function domainFromUrl(raw) {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function looksLikeBusinessWebsite(url) {
  const host = domainFromUrl(url);
  if (!host) return false;
  return !RESEARCH_PARAMS.blockedHosts.some((b) => host.includes(b));
}

function normalizeText(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function extractEmailParts(email) {
  const normalized = normalizeEmail(email);
  const at = normalized.indexOf("@");
  if (at <= 0) return { local: "", domain: "" };
  return {
    local: normalized.slice(0, at),
    domain: normalized.slice(at + 1),
  };
}

function stripWww(host) {
  return String(host || "").toLowerCase().replace(/^www\./, "");
}

function domainsRelated(a, b) {
  const da = stripWww(a);
  const db = stripWww(b);
  if (!da || !db) return false;
  return da === db || da.endsWith(`.${db}`) || db.endsWith(`.${da}`);
}

function allowB2BFreemailException({ emailDomain, siteDomain, contact, fit }) {
  if (!isFreemailDomain(emailDomain)) return false;
  const evidenceUrl = String(contact?.emailEvidenceUrl || "");
  const evidenceDomain = stripWww(domainFromUrl(evidenceUrl));
  const site = stripWww(siteDomain);
  if (!site || !evidenceDomain || !domainsRelated(evidenceDomain, site)) return false;

  const evidencePathStrong = /\/(contact|contact-us|about|shop|store|wholesale)\b/i.test(evidenceUrl);
  const smallStoreHits = Number(fit?.signals?.smallStoreHits || 0);
  const chainHits = Number(fit?.signals?.chainHits || 0);
  const lowIntentHits = Number(fit?.signals?.lowIntentHits || 0);

  return evidencePathStrong && smallStoreHits >= 1 && chainHits === 0 && lowIntentHits === 0;
}

function isValidEmailFormat(email) {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(String(email || ""));
}

function isBadLocalPart(local) {
  const lowered = String(local || "").toLowerCase();
  return RESEARCH_PARAMS.badEmailLocals.some((b) => lowered === b || lowered.startsWith(`${b}+`));
}

function isFreemailDomain(domain) {
  return RESEARCH_PARAMS.freemailDomains.includes(String(domain || "").toLowerCase());
}

async function hasMailRouting(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    if (Array.isArray(mx) && mx.length > 0) return true;
  } catch {
    // fall through to A/AAAA lookup
  }
  try {
    const a = await dns.resolve(domain);
    return Array.isArray(a) && a.length > 0;
  } catch {
    return false;
  }
}

async function verifyBusinessEmail(email, options = {}) {
  const strict = Boolean(options.strict);
  if (!isValidEmailFormat(email)) {
    return { ok: false, reason: "invalid_format", confidence: "none", flags: ["invalid_format"] };
  }
  const { local, domain } = extractEmailParts(email);
  if (!domain) return { ok: false, reason: "missing_domain", confidence: "none", flags: ["missing_domain"] };
  const flags = [];
  if (isBadLocalPart(local)) {
    if (strict) return { ok: false, reason: "role_or_utility_mailbox", confidence: "low", flags: ["role_or_utility_mailbox"] };
    flags.push("role_or_utility_mailbox");
  }
  if (isFreemailDomain(domain)) {
    if (strict) return { ok: false, reason: "freemail_domain", confidence: "low", flags: ["freemail_domain"] };
    flags.push("freemail_domain");
  }
  const routed = await hasMailRouting(domain);
  if (!routed) return { ok: false, reason: "no_mx_or_dns", confidence: "none", flags: ["no_mx_or_dns"] };
  let confidence = "high";
  if (flags.includes("freemail_domain") || flags.includes("role_or_utility_mailbox")) confidence = "medium";
  return { ok: true, reason: flags.length ? `dns_verified_${flags.join("+")}` : "dns_verified", confidence, flags };
}

function extractEmails(text) {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(matches.map((x) => normalizeEmail(x)).filter((x) => !x.endsWith("@example.com")))];
}

function decodeCloudflareEmail(hex) {
  const raw = String(hex || "").trim();
  if (!/^[0-9a-f]+$/i.test(raw) || raw.length < 4 || raw.length % 2 !== 0) return "";
  let out = "";
  const key = Number.parseInt(raw.slice(0, 2), 16);
  for (let i = 2; i < raw.length; i += 2) {
    const val = Number.parseInt(raw.slice(i, i + 2), 16) ^ key;
    out += String.fromCharCode(val);
  }
  return out;
}

function decodeEmailObfuscationText(text) {
  let out = String(text || "");
  out = out
    .replace(/\\u0040/gi, "@")
    .replace(/\\x40/gi, "@")
    .replace(/&commat;/gi, "@")
    .replace(/\\u002e/gi, ".")
    .replace(/\\x2e/gi, ".")
    .replace(/&period;/gi, ".");
  out = out
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const value = Number.parseInt(String(hex || ""), 16);
      return Number.isFinite(value) ? String.fromCharCode(value) : "";
    })
    .replace(/&#([0-9]+);/g, (_, dec) => {
      const value = Number.parseInt(String(dec || ""), 10);
      return Number.isFinite(value) ? String.fromCharCode(value) : "";
    });
  return out;
}

function extractEmailsFromHtml(html) {
  const raw = String(html || "");
  const decodedRaw = decodeEmailObfuscationText(raw);
  const out = new Set(extractEmails(cleanHtmlToText(raw)));
  for (const candidate of extractEmails(cleanHtmlToText(decodedRaw))) out.add(candidate);
  for (const candidate of extractEmails(decodedRaw)) out.add(candidate);

  const mailto = /mailto:([^"'?#\s>]+)/gi;
  let m;
  while ((m = mailto.exec(raw))) {
    const candidate = normalizeEmail(decodeURIComponent(String(m[1] || "").trim()));
    if (candidate && isValidEmailFormat(candidate) && !candidate.endsWith("@example.com")) {
      out.add(candidate);
    }
  }

  const obfuscated = /([A-Z0-9._%+-]{1,64})\s*(?:\[at\]|\(at\)|\sat\s)\s*([A-Z0-9.-]{1,255})\s*(?:\[dot\]|\(dot\)|\sdot\s)\s*([A-Z]{2,24})/gi;
  let o;
  while ((o = obfuscated.exec(raw))) {
    const candidate = normalizeEmail(`${o[1]}@${o[2]}.${o[3]}`);
    if (candidate && isValidEmailFormat(candidate) && !candidate.endsWith("@example.com")) {
      out.add(candidate);
    }
  }

  const cfData = /data-cfemail="([0-9a-f]+)"/gi;
  let c;
  while ((c = cfData.exec(raw))) {
    const decoded = normalizeEmail(decodeCloudflareEmail(c[1]));
    if (decoded && isValidEmailFormat(decoded) && !decoded.endsWith("@example.com")) {
      out.add(decoded);
    }
  }

  const cfHash = /\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi;
  let h;
  while ((h = cfHash.exec(raw))) {
    const decoded = normalizeEmail(decodeCloudflareEmail(h[1]));
    if (decoded && isValidEmailFormat(decoded) && !decoded.endsWith("@example.com")) {
      out.add(decoded);
    }
  }

  const jsConcatAt = /['"`]([A-Z0-9._%+-]{1,64})['"`]\s*\+\s*['"`]@['"`]\s*\+\s*['"`]([A-Z0-9.-]+\.[A-Z]{2,24})['"`]/gi;
  let j1;
  while ((j1 = jsConcatAt.exec(decodedRaw))) {
    const candidate = normalizeEmail(`${j1[1]}@${j1[2]}`);
    if (candidate && isValidEmailFormat(candidate) && !candidate.endsWith("@example.com")) {
      out.add(candidate);
    }
  }

  const jsConcatDot = /['"`]([A-Z0-9._%+-]{1,64})['"`]\s*\+\s*['"`]@['"`]\s*\+\s*['"`]([A-Z0-9.-]{1,255})['"`]\s*\+\s*['"`]\.['"`]\s*\+\s*['"`]([A-Z]{2,24})['"`]/gi;
  let j2;
  while ((j2 = jsConcatDot.exec(decodedRaw))) {
    const candidate = normalizeEmail(`${j2[1]}@${j2[2]}.${j2[3]}`);
    if (candidate && isValidEmailFormat(candidate) && !candidate.endsWith("@example.com")) {
      out.add(candidate);
    }
  }

  return [...out];
}

function extractEmailsFromBinaryBuffer(buffer) {
  if (!buffer) return [];
  const asLatin = Buffer.from(buffer).toString("latin1");
  const emails = extractEmails(asLatin);
  return emails.filter((x) => isValidEmailFormat(x));
}

function extractPhone(text) {
  const match = text.match(/(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  return match ? match[0] : "";
}

function extractCityState(text) {
  const m = text.match(/([A-Z][a-zA-Z.\s'-]+),\s*([A-Z]{2})\b/);
  if (!m) return { city: "", state: "" };
  return { city: m[1].trim(), state: m[2].trim() };
}

function parseAnchorLinks(html, baseUrl) {
  const links = [];
  const re = /<a[^>]*href="([^"]+)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = (m[1] || "").trim();
    if (!href || href.startsWith("javascript:") || href.startsWith("#")) continue;
    try {
      const absolute = new URL(href, baseUrl).toString();
      links.push(absolute);
    } catch {
      // ignore invalid href
    }
  }
  return [...new Set(links)];
}

function cleanHtmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreEmail(email, primaryDomain) {
  const normalized = normalizeEmail(email);
  const { local, domain } = extractEmailParts(normalized);
  let score = 0;
  if (!normalized) return -999;
  if (domain === primaryDomain) score += 5;
  if (local.includes("wholesale")) score += 6;
  if (local.includes("sales")) score += 5;
  if (local.includes("orders")) score += 4;
  if (local.includes("hello")) score += 2;
  if (local.includes("info")) score += 1;
  if (isBadLocalPart(local)) score -= 8;
  if (isFreemailDomain(domain)) score -= 6;
  return score;
}

function pickBestEmail(emails, primaryDomain) {
  const unique = [...new Set((emails || []).map((x) => normalizeEmail(x)).filter(Boolean))];
  if (unique.length === 0) return "";
  return unique.sort((a, b) => scoreEmail(b, primaryDomain) - scoreEmail(a, primaryDomain))[0];
}

function containsKeywords(text, keywords) {
  const t = normalizeText(text);
  return keywords.some((k) => t.includes(k));
}

function countKeywordHits(text, keywords) {
  const t = normalizeText(text);
  return keywords.reduce((sum, keyword) => (t.includes(keyword) ? sum + 1 : sum), 0);
}

function evaluateB2BLead(title, text, url = "", intentText = "") {
  const combined = `${title} ${text} ${url}`;
  const gatingText = `${combined} ${intentText}`;
  if (!containsKeywords(gatingText, RESEARCH_PARAMS.b2bIncludeKeywords)) {
    return { ok: false, score: -2, reason: "missing_b2b_keywords" };
  }

  const lowIntentHits = countKeywordHits(combined, RESEARCH_PARAMS.b2bLowIntentSignals);
  const chainHits = countKeywordHits(combined, RESEARCH_PARAMS.b2bChainSignals);
  const smallStoreHits = countKeywordHits(combined, RESEARCH_PARAMS.b2bSmallStoreSignals);

  let score = 1;
  score += Math.min(smallStoreHits, 4);
  score -= lowIntentHits * 2;
  score -= chainHits * 3;

  const ok = score >= Number(RESEARCH_PARAMS.b2bMinFitScore || 1);
  const reason = !ok
    ? chainHits > 0
      ? "chain_or_corporate_signal"
      : lowIntentHits > 0
        ? "low_intent_signal"
        : "low_fit_score"
    : "qualified";

  return {
    ok,
    score,
    reason,
    signals: {
      smallStoreHits,
      chainHits,
      lowIntentHits,
    },
  };
}

function evaluateDistributorLead(title, text, url = "", intentText = "") {
  const combined = `${title} ${text} ${url}`;
  const gatingText = `${combined} ${intentText}`;
  if (!containsKeywords(gatingText, RESEARCH_PARAMS.distributorIncludeKeywords)) {
    return { ok: false, score: -2, reason: "missing_distributor_keywords" };
  }

  const strongHits = countKeywordHits(combined, RESEARCH_PARAMS.distributorStrongSignals);
  const preferredHits = countKeywordHits(combined, RESEARCH_PARAMS.distributorPreferredSignals);
  const negativeHits = countKeywordHits(combined, RESEARCH_PARAMS.distributorNegativeSignals);

  let score = 1;
  score += Math.min(strongHits, 5);
  score += Math.min(preferredHits, 4);
  score -= negativeHits * 3;

  const ok = score >= Number(RESEARCH_PARAMS.distributorMinFitScore || 2);
  const reason = !ok
    ? negativeHits > 0
      ? "negative_distributor_signal"
      : "low_fit_score"
    : "qualified";

  return {
    ok,
    score,
    reason,
    signals: {
      strongHits,
      preferredHits,
      negativeHits,
    },
  };
}

async function scrapeContact(websiteUrl) {
  return scrapeContactWithOptions(websiteUrl, {});
}

async function discoverDomainEmailViaSearch(websiteUrl, baseDomain) {
  const site = stripWww(baseDomain);
  if (!site) return null;
  const queries = [
    `site:${site} "@${site}" contact`,
    `site:${site} "mailto:"`,
    `site:${site} ("sales@" OR "info@" OR "orders@")`,
    `site:${site} ("line card" OR catalog OR vendor) "@${site}"`,
  ];

  let bestEmail = "";
  let bestEvidenceUrl = "";
  let bestScore = -999;

  for (const query of queries.slice(0, 2)) {
    const results = await promiseWithTimeout(searchWeb(query, 4), 10000, []);
    for (const result of results || []) {
      const cleanUrl = cleanupUrl(result?.url || "");
      if (!cleanUrl) continue;
      const host = domainFromUrl(cleanUrl);
      if (!domainsRelated(host, site)) continue;

      const snippetCandidates = extractEmails(decodeEmailObfuscationText(`${result?.title || ""} ${result?.snippet || ""}`));
      for (const candidate of snippetCandidates) {
        const email = normalizeEmail(candidate);
        const { domain } = extractEmailParts(email);
        if (!domainsRelated(domain, site)) continue;
        const score = scoreEmail(email, site);
        if (score > bestScore) {
          bestScore = score;
          bestEmail = email;
          bestEvidenceUrl = `domain-search-snippet:${query}`;
        }
      }

      try {
        const res = await fetchWithTimeout(cleanUrl, {
          headers: { "User-Agent": HTTP_USER_AGENT },
        }, 6000);
        if (!res.ok) continue;

        const contentType = String(res.headers.get("content-type") || "").toLowerCase();
        let candidates = [];
        if (contentType.includes("pdf") || /\.pdf(\?|$)/i.test(cleanUrl)) {
          const bytes = new Uint8Array(await res.arrayBuffer());
          candidates = extractEmailsFromBinaryBuffer(bytes);
        } else {
          const html = await res.text();
          candidates = extractEmailsFromHtml(html);
        }

        for (const candidate of candidates) {
          const email = normalizeEmail(candidate);
          const { domain } = extractEmailParts(email);
          if (!domainsRelated(domain, site)) continue;
          const score = scoreEmail(email, site);
          if (score > bestScore) {
            bestScore = score;
            bestEmail = email;
            bestEvidenceUrl = cleanUrl;
          }
        }
      } catch {
        // per-page discovery is best effort
      }
    }
  }

  if (!bestEmail) return null;
  return {
    email: bestEmail,
    evidenceUrl: bestEvidenceUrl || websiteUrl,
  };
}

async function scrapeContactWithOptions(websiteUrl, options = {}) {
  const aggressiveEmailDiscovery = Boolean(options.aggressiveEmailDiscovery);
  try {
    const baseRes = await fetchWithTimeout(websiteUrl, {
      headers: { "User-Agent": HTTP_USER_AGENT },
    }, 12000);
    if (!baseRes.ok) return null;
    const baseHtml = await baseRes.text();
    const baseText = cleanHtmlToText(baseHtml);
    const baseDomain = domainFromUrl(websiteUrl).replace(/^www\./, "");
    const emailCandidates = [...extractEmailsFromHtml(baseHtml)];
    const links = parseAnchorLinks(baseHtml, websiteUrl);
    const origin = new URL(websiteUrl).origin;
    const pdfLinks = links
      .map((link) => cleanupUrl(link))
      .filter(Boolean)
      .filter((link) => domainFromUrl(link).includes(baseDomain))
      .filter((link) => /\.pdf(\?|$)/i.test(link))
      .filter((link) => /line[-\s]?card|catalog|brochure|sell[-\s]?sheet|wholesale|distributor/i.test(link))
      .slice(0, 2);

    const preferredPaths = [
      "/contact",
      "/contact-us",
      "/about",
      "/about-us",
      "/team",
      "/our-team",
      "/sales",
      "/wholesale",
      "/distribution",
      "/distributors",
      "/linecard",
      "/line-card",
      "/brands",
    ];
    if (aggressiveEmailDiscovery) {
      preferredPaths.push(
        "/our-brands",
        "/brands-we-carry",
        "/vendor",
        "/vendors",
        "/new-vendors",
        "/locations",
        "/territory",
        "/service-area",
        "/team/sales",
        "/inside-sales"
      );
    }
    const candidatePages = new Set([websiteUrl]);
    const maxCandidatePages = aggressiveEmailDiscovery ? 10 : 5;
    for (const pathName of preferredPaths) {
      try {
        candidatePages.add(new URL(pathName, origin).toString());
      } catch {
        // ignore malformed fallback path
      }
    }
    for (const link of links) {
      const lower = link.toLowerCase();
      if (!lower.startsWith("http")) continue;
      if (!domainFromUrl(link).includes(baseDomain)) continue;
      if (preferredPaths.some((p) => lower.includes(p))) candidatePages.add(link);
      if (candidatePages.size >= maxCandidatePages) break;
    }

    if (candidatePages.size <= (aggressiveEmailDiscovery ? 8 : 4) && emailCandidates.length === 0) {
      try {
        const sitemapRes = await fetchWithTimeout(new URL("/sitemap.xml", origin).toString(), {
          headers: { "User-Agent": HTTP_USER_AGENT },
        }, 5000);
        if (sitemapRes.ok) {
          const sitemapXml = await sitemapRes.text();
          const locMatches = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/gi)];
          const sitemapLimit = aggressiveEmailDiscovery ? 80 : 40;
          for (const entry of locMatches.slice(0, sitemapLimit)) {
            const locUrl = cleanupUrl(String(entry[1] || "").trim());
            if (!locUrl) continue;
            const lower = locUrl.toLowerCase();
            if (!domainFromUrl(locUrl).includes(baseDomain)) continue;
            if (preferredPaths.some((p) => lower.includes(p)) || /privacy|terms|support|customer-service/.test(lower)) {
              candidatePages.add(locUrl);
            }
            if (candidatePages.size >= maxCandidatePages) break;
          }
        }
      } catch {
        // sitemap discovery optional
      }
    }

    let aggregatedText = baseText;
    let phone = extractPhone(baseText);
    let location = extractCityState(baseText);
    let evidenceUrl = websiteUrl;

    for (const pageUrl of candidatePages) {
      if (pageUrl === websiteUrl) continue;
      try {
        const res = await fetchWithTimeout(pageUrl, {
          headers: { "User-Agent": HTTP_USER_AGENT },
        }, 7000);
        if (!res.ok) continue;
        const html = await res.text();
        const text = cleanHtmlToText(html);
        aggregatedText += ` ${text}`;
        const emails = extractEmailsFromHtml(html);
        if (emails.length > 0) {
          emailCandidates.push(...emails);
          evidenceUrl = pageUrl;
        }
        if (!phone) phone = extractPhone(text);
        if (!location.city || !location.state) {
          const loc = extractCityState(text);
          if (loc.city) location = loc;
        }
        if (!aggressiveEmailDiscovery && emailCandidates.length >= 1 && phone) break;
        if (aggressiveEmailDiscovery && emailCandidates.length >= 2 && phone) break;
      } catch {
        // skip per-page failures
      }
    }

    if (emailCandidates.length === 0 && pdfLinks.length > 0) {
      for (const pdfUrl of pdfLinks) {
        try {
          const res = await fetchWithTimeout(pdfUrl, {
            headers: { "User-Agent": HTTP_USER_AGENT },
          }, 7000);
          if (!res.ok) continue;
          const bytes = new Uint8Array(await res.arrayBuffer());
          const emails = extractEmailsFromBinaryBuffer(bytes);
          if (emails.length > 0) {
            emailCandidates.push(...emails);
            evidenceUrl = pdfUrl;
            break;
          }
        } catch {
          // ignore pdf extraction errors
        }
      }
    }

    let relatedEmailCandidates = emailCandidates.filter((candidate) => {
      const { domain } = extractEmailParts(candidate);
      return domainsRelated(domain, baseDomain);
    });

    if (relatedEmailCandidates.length === 0 && aggressiveEmailDiscovery && baseDomain) {
      const discovered = await discoverDomainEmailViaSearch(websiteUrl, baseDomain);
      if (discovered?.email) {
        emailCandidates.push(discovered.email);
        evidenceUrl = discovered.evidenceUrl || evidenceUrl;
        relatedEmailCandidates = emailCandidates.filter((candidate) => {
          const { domain } = extractEmailParts(candidate);
          return domainsRelated(domain, baseDomain);
        });
      }
    }

    const emailPool = aggressiveEmailDiscovery ? relatedEmailCandidates : emailCandidates;
    const email = pickBestEmail(emailPool, baseDomain);
    return {
      email,
      phone,
      city: location.city,
      state: location.state,
      text: aggregatedText.slice(0, 5000),
      emailEvidenceUrl: email ? evidenceUrl : "",
      aggressiveEmailDiscovery,
    };
  } catch {
    return null;
  }
}

async function getExistingEmailSet(dbId, ...fields) {
  const rows = await queryDatabaseAll(dbId);
  const emails = new Set();
  for (const row of rows) {
    for (const field of fields) {
      const prop = row.properties?.[field];
      if (!prop) continue;
      const value = getPlainText(prop);
      if (value) emails.add(normalizeEmail(value));
    }
  }
  return emails;
}

function buildEmailStatusIndex(rows, emailField, isDistributor = false) {
  const index = new Map();
  const touched = sendTouchedStatuses(isDistributor);
  for (const row of rows) {
    const email = normalizeEmail(getPlainText(getPropByName(row, emailField, "Email Address")));
    if (!email) continue;
    const status = getPlainText(getPropByName(row, "Status", "Outreach Status"));
    const hasTouchedStatus = touched.has(status);
    const hasEvidence = hasSendEvidence(row);
    const existing = index.get(email);
    if (!existing) {
      index.set(email, {
        statuses: new Set([status || "(blank)"]),
        touched: hasTouchedStatus || hasEvidence,
      });
      continue;
    }
    existing.statuses.add(status || "(blank)");
    existing.touched = existing.touched || hasTouchedStatus || hasEvidence;
  }
  return index;
}

function isCrossDbAlreadyTouched(index, email) {
  if (!email) return false;
  const meta = index.get(normalizeEmail(email));
  return Boolean(meta?.touched);
}

function normalizeStateForQuery(rawState) {
  const state = String(rawState || "").trim();
  if (!state) return "";
  const compact = state.replace(/\./g, "").toUpperCase();
  if (/^[A-Z]{2}$/.test(compact)) {
    return US_STATE_CODES.has(compact) ? compact : "";
  }
  const byName = US_STATE_NAME_TO_CODE[state.toLowerCase()];
  return byName || "";
}

function addSegmentStat(map, key, isReached, isInterested) {
  if (!key) return;
  if (!map[key]) map[key] = { outreach: 0, interested: 0 };
  if (isReached) map[key].outreach += 1;
  if (isInterested) map[key].interested += 1;
}

function weightedRate(interested, outreach) {
  return (interested + ADAPTIVE_PARAMS.smoothingAlpha) / (outreach + ADAPTIVE_PARAMS.smoothingBeta);
}

function rankSegments(statsMap, limit = 5) {
  return Object.entries(statsMap)
    .map(([segment, counts]) => ({
      segment,
      outreach: counts.outreach || 0,
      interested: counts.interested || 0,
      score: weightedRate(counts.interested || 0, counts.outreach || 0),
    }))
    .filter((x) => x.outreach > 0 || x.interested > 0)
    .sort((a, b) => b.score - a.score || b.interested - a.interested || b.outreach - a.outreach || a.segment.localeCompare(b.segment))
    .slice(0, limit);
}

function uniqueQueryObjects(entries, max = 30) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const q = String(entry?.q || "").trim();
    if (!q) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...entry, q });
    if (out.length >= max) break;
  }
  return out;
}

function interleaveQueryLanes(...lanes) {
  const out = [];
  const arrays = lanes.map((lane) => (Array.isArray(lane) ? lane : []));
  let idx = 0;
  while (true) {
    let addedAny = false;
    for (const lane of arrays) {
      if (idx < lane.length) {
        out.push(lane[idx]);
        addedAny = true;
      }
    }
    if (!addedAny) break;
    idx += 1;
  }
  return out;
}

function buildRepackerAnchoredB2BQueries(repackers, selectedTypes) {
  const out = [];
  const usableRepackers = (repackers || [])
    .filter((r) => Boolean(r?.city) && Boolean(normalizeStateForQuery(r?.state)))
    .slice(0, ADAPTIVE_PARAMS.b2bRepackerCityLimit);
  for (const repacker of usableRepackers) {
    for (const type of selectedTypes.slice(0, 4)) {
      const seeds = B2B_TYPE_SEARCH_SEEDS[type] || B2B_TYPE_SEARCH_SEEDS.Other;
      for (const seed of seeds.slice(0, 1)) {
        out.push({
          q: `${seed} ${repacker.city} ${repacker.state} contact email`,
          type,
          lane: "repacker-local",
          repacker: repacker.name,
        });
      }
    }
  }
  return out;
}

async function buildAdaptiveB2BQueryPlan(repackers = []) {
  const rows = await queryDatabaseAll(IDS.b2bProspects);
  const typeStats = {};
  const stateStats = {};
  const reached = new Set(ADAPTIVE_PARAMS.b2bReachedStatuses);
  const interested = new Set(ADAPTIVE_PARAMS.b2bInterestedStatuses);

  for (const row of rows) {
    const status = getPlainText(getPropByName(row, "Status", "Outreach Status"));
    const type = getPlainText(getPropByName(row, "Business Type")) || "Retailer";
    const state = normalizeStateForQuery(getPlainText(getPropByName(row, "State")));
    const isReached = reached.has(status);
    const isInterested = interested.has(status);
    addSegmentStat(typeStats, type, isReached, isInterested);
    addSegmentStat(stateStats, state, isReached, isInterested);
  }

  const rankedTypes = rankSegments(typeStats, 4);
  const rankedStates = rankSegments(stateStats, 8);
  const selectedTypes = rankedTypes.length > 0 ? rankedTypes.map((x) => x.segment) : ["Gift Shop", "Retailer", "Country Store", "Farm Stand"];
  const selectedStates = rankedStates.length > 0 ? rankedStates.map((x) => x.segment) : ADAPTIVE_PARAMS.defaultStates;

  const repackerQueries = buildRepackerAnchoredB2BQueries(repackers, selectedTypes);
  const adaptiveQueries = [];
  for (const type of selectedTypes) {
    const seeds = B2B_TYPE_SEARCH_SEEDS[type] || B2B_TYPE_SEARCH_SEEDS.Other;
    for (const state of selectedStates.slice(0, 6)) {
      for (const seed of seeds.slice(0, 2)) {
        adaptiveQueries.push({
          q: `${seed} ${state} usa contact email`,
          type,
          lane: "state-priority",
        });
      }
    }
  }

  const fallbackQueries = RESEARCH_PARAMS.b2bQueries.map((entry) => ({ ...entry, lane: "national-fallback" }));
  const combinedQueries = uniqueQueryObjects(
    [...repackerQueries, ...adaptiveQueries, ...fallbackQueries],
    ADAPTIVE_PARAMS.b2bMaxAdaptiveQueries
  );
  return {
    queries: combinedQueries,
    rankedTypes,
    rankedStates,
    lanes: {
      repackerLocal: repackerQueries.length,
      statePriority: adaptiveQueries.length,
      nationalFallback: fallbackQueries.length,
    },
  };
}

async function buildAdaptiveDistributorStatePlan() {
  const rows = await queryDatabaseAll(IDS.distributorProspects);
  const stateStats = {};
  const reached = new Set(ADAPTIVE_PARAMS.distributorReachedStatuses);
  const interested = new Set(ADAPTIVE_PARAMS.distributorInterestedStatuses);

  for (const row of rows) {
    const status = getPlainText(getPropByName(row, "Status", "Outreach Status"));
    const state = normalizeStateForQuery(getPlainText(getPropByName(row, "State")));
    addSegmentStat(stateStats, state, reached.has(status), interested.has(status));
  }

  const rankedStates = rankSegments(stateStats, ADAPTIVE_PARAMS.distributorMaxAdaptiveStates);
  const states = rankedStates.length > 0 ? rankedStates.map((x) => x.segment) : ADAPTIVE_PARAMS.defaultStates.slice(0, ADAPTIVE_PARAMS.distributorMaxAdaptiveStates);
  return { states, rankedStates };
}

function buildDistributorQueryPlan(repackers, adaptiveStates = []) {
  const repackerLocalQueries = [];
  const repackerReferenceQueries = [];
  const statePriorityQueries = [];
  const nationalExpansionQueries = [];
  const anchorStates = new Set();
  for (const repacker of repackers || []) {
    const state = normalizeStateForQuery(repacker.state);
    if (state) anchorStates.add(state);
  }
  for (const state of adaptiveStates || []) {
    const normalized = normalizeStateForQuery(state);
    if (normalized) anchorStates.add(normalized);
  }
  const prioritizedAnchorStates = [...anchorStates].slice(0, 8);

  for (const repacker of repackers || []) {
    const repackerState = normalizeStateForQuery(repacker.state);
    if (!repackerState) continue;
    const repackerCity = String(repacker.city || "").trim();
    for (const tpl of RESEARCH_PARAMS.distributorQueryTemplates) {
      if (!repackerCity) continue;
      repackerLocalQueries.push({
        q: tpl.replace("{city}", repackerCity).replace("{state}", repackerState),
        lane: "repacker-local",
        repacker: repacker.name,
        anchorState: repackerState,
      });
    }
    if (repackerCity) {
      repackerLocalQueries.push({
        q: `food distributor ${repackerCity} ${repackerState} "contact us"`,
        lane: "repacker-local",
        repacker: repacker.name,
        anchorState: repackerState,
      });
      repackerLocalQueries.push({
        q: `convenience distributor ${repackerCity} ${repackerState} line card pdf`,
        lane: "repacker-local",
        repacker: repacker.name,
        anchorState: repackerState,
      });
    }
  }

  for (const ref of RESEARCH_PARAMS.distributorReferenceNames) {
    repackerReferenceQueries.push({
      q: `${ref} distributor contact email`,
      lane: "repacker-reference",
    });
    for (const state of prioritizedAnchorStates.slice(0, 3)) {
      repackerReferenceQueries.push({
        q: `${ref} distributor ${state} contact email`,
        lane: "repacker-reference",
        anchorState: state,
      });
    }
  }

  for (const state of adaptiveStates.slice(0, ADAPTIVE_PARAMS.distributorMaxAdaptiveStates)) {
    statePriorityQueries.push({ q: `food distributor ${state} contact email`, lane: "state-priority", anchorState: state });
    statePriorityQueries.push({ q: `snack wholesaler ${state} distribution email`, lane: "state-priority", anchorState: state });
    statePriorityQueries.push({ q: `candy distributor ${state} wholesale email`, lane: "state-priority", anchorState: state });
    statePriorityQueries.push({ q: `convenience store distributor ${state} contact us`, lane: "state-priority", anchorState: state });
    statePriorityQueries.push({ q: `foodservice distributor ${state} line card pdf`, lane: "state-priority", anchorState: state });
  }

  const expansionStates = RESEARCH_PARAMS.nationalFocusStates.slice(0, ADAPTIVE_PARAMS.distributorNationalExpansionStates);
  for (const state of expansionStates) {
    for (const tpl of RESEARCH_PARAMS.distributorNationalQueryTemplates) {
      nationalExpansionQueries.push({
        q: tpl.replace("{state}", state),
        lane: "national-expansion",
        anchorState: state,
      });
    }
  }

  const prioritized = interleaveQueryLanes(
    repackerLocalQueries,
    statePriorityQueries,
    repackerReferenceQueries,
    nationalExpansionQueries
  );
  const capped = uniqueQueryObjects(prioritized, ADAPTIVE_PARAMS.distributorMaxAdaptiveQueries);
  return {
    queries: capped,
    lanes: {
      repackerLocal: repackerLocalQueries.length,
      repackerReference: repackerReferenceQueries.length,
      statePriority: statePriorityQueries.length,
      nationalExpansion: nationalExpansionQueries.length,
    },
  };
}

function buildRecoveryB2BQueries(repackers = []) {
  const out = [];
  const priorityStates = [...ADAPTIVE_PARAMS.defaultStates, "WA", "UT", "PA", "IL", "FL", "TX"];
  const seeds = ["independent gift shop", "country store", "farm market", "toy store", "candy shop"];

  for (const state of priorityStates.slice(0, 12)) {
    for (const seed of seeds) {
      out.push({ q: `${seed} ${state} contact email`, type: "Gift Shop", lane: "recovery-state" });
      out.push({ q: `${seed} ${state} "mailto"`, type: "Gift Shop", lane: "recovery-state" });
    }
  }

  for (const repacker of (repackers || []).slice(0, 8)) {
    if (!repacker?.city || !repacker?.state) continue;
    out.push({ q: `independent gift shop ${repacker.city} ${repacker.state} contact email`, type: "Gift Shop", lane: "recovery-city" });
    out.push({ q: `country store ${repacker.city} ${repacker.state} contact email`, type: "Country Store", lane: "recovery-city" });
  }

  return uniqueQueryObjects(out, 60);
}

async function runB2BResearcher(target = 40, options = {}) {
  const tuning = loadKpiTuning();
  const deliverabilityGuard = loadDeliverabilityGuard();
  const recoveryMode = Boolean(options.recovery);
  const effectiveTarget = Math.max(1, Math.ceil(Number(target || 0) * Number(tuning.b2bResearchMultiplier || 1)));
  let searchCallCap = clampNumber(
    Number(tuning.b2bSearchCallsCap || ADAPTIVE_PARAMS.b2bMaxSearchCallsPerRun),
    KPI_GOVERNOR_POLICY.minSearchCap,
    KPI_GOVERNOR_POLICY.maxSearchCap
  );
  if (recoveryMode) {
    searchCallCap = clampNumber(searchCallCap + 6, KPI_GOVERNOR_POLICY.minSearchCap, KPI_GOVERNOR_POLICY.maxSearchCap + 8);
  }
  const existing = await getExistingEmailSet(IDS.b2bProspects, "Email", "Email Address");
  const repackers = await loadRepackers();
  const adaptive = await buildAdaptiveB2BQueryPlan(repackers);
  const queries = recoveryMode
    ? uniqueQueryObjects([...adaptive.queries, ...buildRecoveryB2BQueries(repackers)], 60)
    : adaptive.queries;
  const runStartedAt = Date.now();
  const runtimeBudgetMs = Math.max(30000, Number(process.env.RESEARCH_MAX_RUNTIME_MS || 120000));
  let runtimeBudgetHit = false;

  let added = 0;
  let scanned = 0;
  let searchCalls = 0;
  let skippedNoEmail = 0;
  let skippedNotQualified = 0;
  let skippedUnverified = 0;
  let skippedDomainMismatch = 0;
  let allowedFreemailExceptions = 0;
  let skippedDeliverability = 0;
  let skippedExisting = 0;
  const errors = [];

  for (const entry of queries) {
    if (Date.now() - runStartedAt > runtimeBudgetMs) {
      runtimeBudgetHit = true;
      break;
    }
    if (added >= effectiveTarget) break;
    if (searchCalls >= searchCallCap) break;
    searchCalls += 1;
    const results = await searchWeb(entry.q, 5);
    for (const result of results) {
      if (Date.now() - runStartedAt > runtimeBudgetMs) {
        runtimeBudgetHit = true;
        break;
      }
      if (added >= effectiveTarget) break;
      const url = cleanupUrl(result.url);
      if (!url || !looksLikeBusinessWebsite(url)) continue;
      scanned += 1;

      const contact = await promiseWithTimeout(scrapeContact(url), 15000, null);
      const leadText = `${result.title} ${result?.snippet || ""} ${contact?.text || ""}`;
      const fit = evaluateB2BLead(result.title, leadText, url, entry.q);
      const recoveryFitPass = recoveryMode && fit.score >= 0 && Number(fit?.signals?.chainHits || 0) === 0;
      if (!fit.ok && !recoveryFitPass) {
        skippedNotQualified += 1;
        continue;
      }

      const siteDomain = domainFromUrl(url);
      let email = normalizeEmail(contact?.email || "");
      let emailEvidence = contact?.emailEvidenceUrl || url;
      if (!email) {
        const snippetEmail = pickBestEmail(extractEmails(String(result?.snippet || "")), siteDomain);
        if (snippetEmail) {
          email = normalizeEmail(snippetEmail);
          emailEvidence = `search-snippet:${entry.q}`;
        }
      }
      if (!email) {
        skippedNoEmail += 1;
        continue;
      }
      const { domain: emailDomain } = extractEmailParts(email);
      const relatedDomains = domainsRelated(emailDomain, siteDomain);
      const freemailException = !relatedDomains
        ? allowB2BFreemailException({ emailDomain, siteDomain, contact, fit })
        : false;
      if (!relatedDomains && !freemailException) {
        skippedUnverified += 1;
        skippedDomainMismatch += 1;
        continue;
      }
      if (freemailException) allowedFreemailExceptions += 1;
      if (isDomainBlockedByDeliverability(emailDomain, deliverabilityGuard)) {
        skippedDeliverability += 1;
        continue;
      }
      if (existing.has(email)) {
        skippedExisting += 1;
        continue;
      }

      const verification = await verifyBusinessEmail(email);
      if (!verification.ok) {
        skippedUnverified += 1;
        continue;
      }

      const fallbackLoc = extractCityState(`${result.title}`);
      const businessName = stripEmojiPrefix(result.title.split("|")[0].split("-")[0].trim()) || domainFromUrl(url);
      const businessType = B2B_TYPE_SEARCH_SEEDS[entry.type] ? entry.type : "Other";

      const values = {
        "Business Name": businessName,
        "Contact Name": "",
        Email: email,
        Phone: contact?.phone || "",
        City: contact?.city || fallbackLoc.city || "",
        State: contact?.state || fallbackLoc.state || "",
        "Business Type": businessType,
        Source: `web search (${entry.lane || "adaptive"}): ${entry.q}`,
        Status: "New - Uncontacted",
        Notes: `Website: ${url}\nEmail source: ${emailEvidence}\nEmail verification: ${verification.reason}\nFit score: ${fit.score} (${fit.reason})${freemailException ? "\nFreemail exception: approved (evidence-based small-store contact)." : ""}${recoveryMode ? "\nRecovery mode: yes" : ""}`,
        "Fair.com Referred": false,
      };

      try {
        const props = buildProperties(IDS.b2bProspects, values);
        await createPageInDb(IDS.b2bProspects, props);
        existing.add(email);
        added += 1;
      } catch (err) {
        errors.push(String(err.message || err).slice(0, 180));
      }
    }
    if (runtimeBudgetHit) break;
  }

  if (runtimeBudgetHit) {
    errors.push(`runtime_budget_exceeded_${Math.floor(runtimeBudgetMs / 1000)}s`);
  }

  let status = errors.length ? (added > 0 || scanned > 0 ? "Partial" : "Failed") : "Success";
  if (status === "Success" && added === 0) {
    status = scanned > 0 ? "Partial" : "Failed";
  } else if (status === "Success" && added < Math.max(1, Math.ceil(effectiveTarget * 0.3))) {
    status = "Partial";
  }
  await logRun({
    agentName: "Agent 1 — B2B Business Researcher",
    recordsProcessed: added,
    emailsSent: 0,
    errors: errors.join(" | "),
    status,
    notes: `Target ${target}; effective_target ${effectiveTarget}; recovery_mode ${recoveryMode ? "yes" : "no"}; search_calls ${searchCalls}/${searchCallCap}; scanned ${scanned}; added ${added}; skipped_existing ${skippedExisting}; skipped_no_email ${skippedNoEmail}; skipped_not_qualified ${skippedNotQualified}; skipped_unverified ${skippedUnverified}; skipped_domain_mismatch ${skippedDomainMismatch}; freemail_exceptions ${allowedFreemailExceptions}; skipped_deliverability ${skippedDeliverability}; repackers ${repackers.map((r) => `${r.name}:${r.city},${r.state}`).join(" | ")}; lanes repacker=${adaptive.lanes.repackerLocal} state=${adaptive.lanes.statePriority} national=${adaptive.lanes.nationalFallback}; priority_types ${adaptive.rankedTypes.map((x) => `${x.segment}:${x.interested}/${x.outreach}`).join(",") || "fallback"}; priority_states ${adaptive.rankedStates.map((x) => `${x.segment}:${x.interested}/${x.outreach}`).join(",") || "fallback"}.`,
  });

  return {
    target,
    effectiveTarget,
    recoveryMode,
    searchCallCap,
    added,
    scanned,
    skippedExisting,
    skippedNoEmail,
    skippedNotQualified,
    skippedUnverified,
    skippedDomainMismatch,
    allowedFreemailExceptions,
    skippedDeliverability,
    searchCalls,
    repackers: repackers.map((r) => ({ name: r.name, city: r.city, state: r.state })),
    lanes: adaptive.lanes,
    priorityTypes: adaptive.rankedTypes,
    priorityStates: adaptive.rankedStates,
    errors,
    status,
  };
}

async function geocode(query) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": HTTP_USER_AGENT } }, 12000);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data[0]) return null;
    return { lat: Number(data[0].lat), lon: Number(data[0].lon) };
  } catch {
    return null;
  }
}

function haversineMiles(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function loadRepackers() {
  const rows = await queryDatabaseAll(IDS.repackerList);
  const out = [];
  const seen = new Set();

  const addRepacker = async (nameRaw, cityRaw, stateRaw) => {
    const name = String(nameRaw || "").trim();
    if (!name) return;

    let city = String(cityRaw || "").trim();
    let state = normalizeStateForQuery(stateRaw);

    const fromCity = extractCityState(city);
    if (!state && fromCity.state) state = normalizeStateForQuery(fromCity.state);
    if (!city && fromCity.city) city = fromCity.city;

    const fromName = extractCityState(name);
    if (!state && fromName.state) state = normalizeStateForQuery(fromName.state);
    if (!city && fromName.city) city = fromName.city;

    city = city.replace(/\s*,\s*[A-Z]{2}\b/, "").trim();
    if (!state && city) {
      const fromCityName = normalizeStateForQuery(city.split(" ").slice(-1)[0]);
      if (fromCityName) state = fromCityName;
    }

    const key = `${name.toLowerCase()}|${city.toLowerCase()}|${state}`;
    if (seen.has(key)) return;
    seen.add(key);

    const geocodeQuery = city && state ? `${city} ${state} USA` : state ? `${state} USA` : city;
    const geo = geocodeQuery ? await geocode(geocodeQuery) : null;
    out.push({ name, city, state, geo });
  };

  for (const row of rows) {
    const name = getPlainText(getPropByName(row, "Repacker Name", "Name"));
    const city = getPlainText(getPropByName(row, "City", "Location"));
    const state = getPlainText(getPropByName(row, "State"));
    await addRepacker(name, city, state);
    if (out.length >= 10) break;
  }

  for (const hub of REPACKER_ANCHOR_HUBS) {
    const hasAnchor = out.some(
      (r) =>
        normalizeStateForQuery(r.state) === hub.state &&
        String(r.city || "").toLowerCase() === hub.city.toLowerCase()
    );
    if (!hasAnchor) {
      await addRepacker(hub.name, hub.city, hub.state);
    }
  }

  return out.slice(0, 15);
}

function pickNearestRepackerFromGeo(repackers, geo, fallback = null) {
  if (!geo) return fallback || null;
  let best = null;
  for (const repacker of repackers || []) {
    if (!repacker?.geo) continue;
    const miles = haversineMiles(repacker.geo, geo);
    if (!Number.isFinite(miles)) continue;
    if (!best || miles < best.distanceMiles) {
      best = {
        name: repacker.name,
        city: repacker.city,
        state: repacker.state,
        distanceMiles: Number(miles.toFixed(1)),
      };
    }
  }
  return best || fallback || null;
}

function buildRecoveryDistributorQueries(repackers = []) {
  const out = [];
  const states = [...RESEARCH_PARAMS.nationalFocusStates, ...ADAPTIVE_PARAMS.defaultStates, "WA", "UT", "PA", "IL", "FL", "TX"];
  for (const state of states.slice(0, 14)) {
    out.push({ q: `candy distributor ${state} contact email`, lane: "recovery-state", anchorState: state });
    out.push({ q: `snack wholesale distributor ${state} sales email`, lane: "recovery-state", anchorState: state });
    out.push({ q: `confectionery wholesaler ${state} line card email`, lane: "recovery-state", anchorState: state });
  }
  for (const repacker of (repackers || []).slice(0, 8)) {
    if (!repacker?.city || !repacker?.state) continue;
    out.push({ q: `food distributor ${repacker.city} ${repacker.state} line card email`, lane: "recovery-city", repacker: repacker.name, anchorState: repacker.state });
    out.push({ q: `candy distributor ${repacker.city} ${repacker.state} contact email`, lane: "recovery-city", repacker: repacker.name, anchorState: repacker.state });
  }
  for (const ref of RESEARCH_PARAMS.distributorReferenceNames || []) {
    out.push({ q: `${ref} distributor contact email`, lane: "recovery-reference" });
    out.push({ q: `${ref} foodservice distributor sales email`, lane: "recovery-reference" });
  }
  return uniqueQueryObjects(out, 80);
}

async function runDistributorResearcher(target = 10, options = {}) {
  const tuning = loadKpiTuning();
  const deliverabilityGuard = loadDeliverabilityGuard();
  const recoveryMode = Boolean(options.recovery);
  const effectiveTarget = Math.max(1, Math.ceil(Number(target || 0) * Number(tuning.distributorResearchMultiplier || 1)));
  let searchCallCap = clampNumber(
    Number(tuning.distributorSearchCallsCap || ADAPTIVE_PARAMS.distributorMaxSearchCallsPerRun),
    KPI_GOVERNOR_POLICY.minSearchCap,
    KPI_GOVERNOR_POLICY.maxSearchCap
  );
  if (recoveryMode) {
    searchCallCap = clampNumber(searchCallCap + 6, KPI_GOVERNOR_POLICY.minSearchCap, KPI_GOVERNOR_POLICY.maxSearchCap + 8);
  }
  const existing = await getExistingEmailSet(IDS.distributorProspects, "Email");
  const repackers = await loadRepackers();
  const adaptive = await buildAdaptiveDistributorStatePlan();
  const queryPlan = buildDistributorQueryPlan(repackers, adaptive.states);
  const queries = recoveryMode
    ? uniqueQueryObjects([...queryPlan.queries, ...buildRecoveryDistributorQueries(repackers)], 90)
    : queryPlan.queries;
  const runStartedAt = Date.now();
  const runtimeBudgetMs = Math.max(30000, Number(process.env.RESEARCH_MAX_RUNTIME_MS || 120000));
  let runtimeBudgetHit = false;
  const errors = [];
  let added = 0;
  let scanned = 0;
  let searchCalls = 0;
  let skippedNoEmail = 0;
  let skippedNotQualified = 0;
  let skippedUnverified = 0;
  let skippedDeliverability = 0;
  let skippedExisting = 0;

  for (const entry of queries) {
    if (Date.now() - runStartedAt > runtimeBudgetMs) {
      runtimeBudgetHit = true;
      break;
    }
    if (added >= effectiveTarget) break;
    if (searchCalls >= searchCallCap) break;
    searchCalls += 1;
    const results = await searchWeb(entry.q, 5);

    for (const result of results) {
      if (Date.now() - runStartedAt > runtimeBudgetMs) {
        runtimeBudgetHit = true;
        break;
      }
      if (added >= effectiveTarget) break;
      const url = cleanupUrl(result.url);
      if (!url || !looksLikeBusinessWebsite(url)) continue;

      scanned += 1;
      const contact = await promiseWithTimeout(scrapeContactWithOptions(url, { aggressiveEmailDiscovery: true }), 18000, null);
      const leadText = `${result.title} ${result?.snippet || ""} ${contact?.text || ""}`;
      const fit = evaluateDistributorLead(result.title, leadText, url, entry.q);
      const queryIntentDistributor = /(distributor|distribution|wholesale|wholesaler|foodservice|confectionery|snack|grocery|convenience|c-store|line card)/.test(normalizeText(entry.q || ""));
      const recoveryFitPass = recoveryMode
        && queryIntentDistributor
        && Number(fit?.signals?.negativeHits || 0) === 0;
      if (!fit.ok && !recoveryFitPass) {
        skippedNotQualified += 1;
        continue;
      }

      const siteDomain = domainFromUrl(url);
      let email = normalizeEmail(contact?.email || "");
      let emailEvidence = contact?.emailEvidenceUrl || url;
      if (!email) {
        const snippetEmail = pickBestEmail(extractEmails(String(result?.snippet || "")), siteDomain);
        if (snippetEmail) {
          email = normalizeEmail(snippetEmail);
          emailEvidence = `search-snippet:${entry.q}`;
        }
      }
      if (!email) {
        skippedNoEmail += 1;
        continue;
      }
      const { domain: emailDomain } = extractEmailParts(email);
      if (!domainsRelated(emailDomain, siteDomain)) {
        skippedUnverified += 1;
        continue;
      }
      if (isDomainBlockedByDeliverability(emailDomain, deliverabilityGuard)) {
        skippedDeliverability += 1;
        continue;
      }
      if (existing.has(email)) {
        skippedExisting += 1;
        continue;
      }

      const verification = await verifyBusinessEmail(email);
      if (!verification.ok) {
        skippedUnverified += 1;
        continue;
      }

      const companyName = stripEmojiPrefix(result.title.split("|")[0].split("-")[0].trim()) || domainFromUrl(url);
      const guessed = extractCityState(`${contact?.city || ""} ${contact?.state || ""} ${result.title}`);
      const city = contact?.city || guessed.city || "";
      const state = contact?.state || guessed.state || normalizeStateForQuery(entry.anchorState || "") || "";
      const anchorRepacker = repackers.find((r) => r.name === entry.repacker) || repackers[0] || null;

      let nearest = anchorRepacker
        ? { name: anchorRepacker.name, city: anchorRepacker.city, state: anchorRepacker.state, distanceMiles: null }
        : null;
      if (city && state) {
        try {
          const companyGeo = await geocode(`${city} ${state} USA`);
          nearest = pickNearestRepackerFromGeo(repackers, companyGeo, nearest);
        } catch {
          nearest = nearest || null;
        }
      }

      const values = {
        "Company Name": companyName,
        "Contact Name": "",
        Email: email,
        Phone: contact?.phone || "",
        City: city,
        State: state,
        "Distance from Repacker": nearest?.distanceMiles ?? null,
        "Nearest Repacker Location": nearest?.name || "TBD",
        Source: `web search (${entry.lane || "adaptive"}): ${entry.q}`,
        Status: "New - Uncontacted",
        Notes: `Website: ${url}\nEmail source: ${emailEvidence}\nEmail verification: ${verification.reason}\nFit score: ${fit.score} (${fit.reason})${recoveryMode ? "\nRecovery mode: yes" : ""}${nearest?.distanceMiles === null || nearest?.distanceMiles === undefined ? "\nDistance unavailable" : ""}`,
      };

      try {
        const props = buildProperties(IDS.distributorProspects, values);
        await createPageInDb(IDS.distributorProspects, props);
        existing.add(email);
        added += 1;
      } catch (err) {
        errors.push(String(err.message || err).slice(0, 180));
      }
    }
    if (runtimeBudgetHit) break;
  }

  if (runtimeBudgetHit) {
    errors.push(`runtime_budget_exceeded_${Math.floor(runtimeBudgetMs / 1000)}s`);
  }

  let status = errors.length ? (added > 0 || scanned > 0 ? "Partial" : "Failed") : "Success";
  if (status === "Success" && added === 0) {
    status = scanned > 0 ? "Partial" : "Failed";
  } else if (status === "Success" && added < Math.max(1, Math.ceil(effectiveTarget * 0.3))) {
    status = "Partial";
  }
  await logRun({
    agentName: "Agent 2 — Distributor Researcher",
    recordsProcessed: added,
    emailsSent: 0,
    errors: errors.join(" | "),
    status,
    notes: `Target ${target}; effective_target ${effectiveTarget}; recovery_mode ${recoveryMode ? "yes" : "no"}; search_calls ${searchCalls}/${searchCallCap}; scanned ${scanned}; added ${added}; skipped_existing ${skippedExisting}; skipped_no_email ${skippedNoEmail}; skipped_not_qualified ${skippedNotQualified}; skipped_unverified ${skippedUnverified}; skipped_deliverability ${skippedDeliverability}; repackers ${repackers.map((r) => `${r.name}:${r.city},${r.state}`).join(" | ")}; lanes repacker_local=${queryPlan.lanes.repackerLocal} repacker_reference=${queryPlan.lanes.repackerReference} state_priority=${queryPlan.lanes.statePriority} national=${queryPlan.lanes.nationalExpansion}; priority_states ${adaptive.rankedStates.map((x) => `${x.segment}:${x.interested}/${x.outreach}`).join(",") || "fallback"}.`,
  });

  return {
    target,
    effectiveTarget,
    recoveryMode,
    searchCallCap,
    added,
    scanned,
    skippedExisting,
    skippedNoEmail,
    skippedNotQualified,
    skippedUnverified,
    skippedDeliverability,
    searchCalls,
    repackers: repackers.map((r) => ({ name: r.name, city: r.city, state: r.state })),
    lanes: queryPlan.lanes,
    priorityStates: adaptive.rankedStates,
    errors,
    status,
  };
}

async function runDistributorReferenceSeeder(limit = 8) {
  const cap = Math.max(1, Number(limit || 0));
  const existing = await getExistingEmailSet(IDS.distributorProspects, "Email");
  const repackers = await loadRepackers();
  const errors = [];
  let reviewed = 0;
  let added = 0;
  let skippedExisting = 0;
  let skippedUnverified = 0;

  for (const seed of DISTRIBUTOR_REFERENCE_SEEDS.slice(0, cap)) {
    reviewed += 1;
    const email = normalizeEmail(seed.email || "");
    if (!email) continue;
    if (existing.has(email)) {
      skippedExisting += 1;
      continue;
    }
    const verification = await verifyBusinessEmail(email);
    if (!verification.ok) {
      skippedUnverified += 1;
      continue;
    }

    let nearest = repackers[0]
      ? { name: repackers[0].name, city: repackers[0].city, state: repackers[0].state, distanceMiles: null }
      : null;
    if (seed.city && seed.state) {
      const companyGeo = await geocode(`${seed.city} ${seed.state} USA`);
      nearest = pickNearestRepackerFromGeo(repackers, companyGeo, nearest);
    }

    const values = {
      "Company Name": seed.company,
      "Contact Name": "",
      Email: email,
      Phone: "",
      City: seed.city || "",
      State: seed.state || "",
      "Distance from Repacker": nearest?.distanceMiles ?? null,
      "Nearest Repacker Location": nearest?.name || "TBD",
      Source: `distributor reference seed (${seed.source || "manual"})`,
      Status: "New - Uncontacted",
      Notes: `Seeded from trusted distributor reference list.\nEmail verification: ${verification.reason}`,
    };

    try {
      const props = buildProperties(IDS.distributorProspects, values);
      await createPageInDb(IDS.distributorProspects, props);
      existing.add(email);
      added += 1;
    } catch (err) {
      errors.push(String(err.message || err).slice(0, 180));
    }
  }

  const status = errors.length ? (added > 0 ? "Partial" : "Failed") : "Success";
  await logRun({
    agentName: "Agent 22 — Distributor Reference Seeder",
    recordsProcessed: added,
    emailsSent: 0,
    errors: errors.join(" | "),
    status,
    notes: `Reviewed ${reviewed}; added ${added}; skipped_existing ${skippedExisting}; skipped_unverified ${skippedUnverified}.`,
  });

  return {
    reviewed,
    added,
    skippedExisting,
    skippedUnverified,
    errors,
    status,
  };
}

function renderTemplate(text, vars) {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`[${k}]`, v || "");
  }
  return out;
}

function sendEmail({ to, subject, body, dryRun }) {
  const args = [SEND_EMAIL_SCRIPT, "--to", to, "--subject", subject, "--body", body];
  if (dryRun) args.push("--dry-run");
  const res = spawnSync("bash", args, { encoding: "utf8" });
  return {
    ok: res.status === 0,
    output: `${res.stdout || ""}${res.stderr || ""}`.trim(),
  };
}

function buildSendIntentNote(notesNow, email, subject) {
  return `${notesNow}\n[send-intent] ${nowETTimestamp()} ET: prepared initial outreach to ${email} (${subject}).`.trim();
}

async function runB2BEmailSender(limit = 25, dryRun = false) {
  const requested = Math.max(0, Number(limit || 0));
  const sentTodayBefore = sumAgentSendsForDate("agent3", todayET());
  const remainingFloor = Math.max(0, SEND_POLICY.b2bFloorPerDay - sentTodayBefore);
  const floorTarget = Math.max(requested, remainingFloor);
  const hardMax = SEND_POLICY.b2bHardMaxPerDay;
  const remainingHardAllowance = Math.max(0, hardMax - sentTodayBefore);
  const pullCount = Math.max(0, Math.min(remainingHardAllowance, floorTarget));
  const [rows, distRows] = await Promise.all([
    queryDatabaseAll(IDS.b2bProspects),
    queryDatabaseAll(IDS.distributorProspects),
  ]);
  const distributorIndex = buildEmailStatusIndex(distRows, "Email", true);
  const candidates = rows
    .filter((r) => {
      const status = getPlainText(getPropByName(r, "Status", "Outreach Status"));
      const email = normalizeEmail(getPlainText(getPropByName(r, "Email", "Email Address")));
      return status === "New - Uncontacted" && Boolean(email);
    })
    .sort((a, b) => new Date(a.created_time).getTime() - new Date(b.created_time).getTime())
    .slice(0, pullCount);

  let sent = 0;
  let blockedUnverified = 0;
  let blockedDuplicate = 0;
  let queuedNotionSync = 0;
  let sendFailures = 0;
  const failures = [];
  const sentHistory = loadRecentSentEmailSet();
  const reconcileBefore = dryRun
    ? { pendingBefore: 0, resolvedNow: 0, failedNow: 0, stillPending: 0 }
    : await reconcilePendingSendCommits(120);

  for (const row of candidates) {
    const freshRow = await getPage(row.id);
    const email = normalizeEmail(getPlainText(getPropByName(freshRow, "Email", "Email Address")));
    if (!email) continue;

    const statusNow = getPlainText(getPropByName(freshRow, "Status", "Outreach Status"));
    const firstContacted = getPlainText(getPropByName(freshRow, "Date First Contacted"));
    const existingCopy = getPlainText(getPropByName(freshRow, "Email Copy Sent"));
    const notesNow = getPlainText(getPropByName(freshRow, "Notes"));

    if (statusNow !== "New - Uncontacted") {
      failures.push(`${email}: blocked_not_new`);
      blockedDuplicate += 1;
      continue;
    }

    if (isCrossDbAlreadyTouched(distributorIndex, email)) {
      const flagged = appendTaggedNote(
        notesNow,
        "send-guard-cross-db",
        `${todayET()} ET: blocked initial send. Same email exists in Distributor CRM with outreach activity.`
      );
      await updatePage(
        freshRow.id,
        buildProperties(IDS.b2bProspects, {
          Notes: flagged.text,
        })
      );
      failures.push(`${email}: blocked_cross_db_touched`);
      blockedDuplicate += 1;
      continue;
    }

    const resendCheck = buildNoResendDecision({
      status: statusNow,
      dateFirstContacted: firstContacted,
      emailCopySent: existingCopy,
      email,
      sentHistory,
    });
    if (resendCheck.blocked) {
      const updates = {
        Notes: `${notesNow}\nSend blocked ${todayET()} ET: no-resend guard (${resendCheck.reasons.join(",")}).`.trim(),
      };
      if (statusNow === "New - Uncontacted" && resendCheck.shouldPromoteToOutreach) {
        updates.Status = "Outreach Sent";
      }
      await updatePage(freshRow.id, buildProperties(IDS.b2bProspects, updates));
      failures.push(`${email}: blocked_no_resend_${resendCheck.reasons.join("+")}`);
      blockedDuplicate += 1;
      continue;
    }

    const verification = await verifyBusinessEmail(email);
    if (!verification.ok) {
      const updates = {
        Notes: `${notesNow}\nSend blocked ${todayET()} ET: unverified email (${verification.reason}).`.trim(),
      };
      if (isHardVerificationFailure(verification.reason)) {
        updates.Status = "Bounced";
      }
      await updatePage(freshRow.id, buildProperties(IDS.b2bProspects, updates));
      failures.push(`${email}: blocked_unverified_${verification.reason}`);
      blockedUnverified += 1;
      continue;
    }
    const contactName = getPlainText(getPropByName(freshRow, "Contact Name"));
    const business = getPlainText(getPropByName(freshRow, "Business Name"));
    const firstName = getFirstName(contactName);

    const subject = TEMPLATE_LIBRARY.b2bInitial.subject;
    let body = renderTemplate(TEMPLATE_LIBRARY.b2bInitial.body, {
      "First Name": firstName,
      "Business Name": business,
    });
    if (!contactName) body = body.replace("Hi there,", "Hi there,");

    if (!dryRun) {
      const intentNote = buildSendIntentNote(notesNow, email, subject);
      try {
        await updatePage(
          freshRow.id,
          buildProperties(IDS.b2bProspects, {
            Notes: intentNote,
          })
        );
      } catch (err) {
        failures.push(`${email}: send_intent_failed_${String(err?.message || err).slice(0, 80)}`);
        continue;
      }
    }

    const result = sendEmail({ to: email, subject, body, dryRun });
    if (!result.ok) {
      sendFailures += 1;
      failures.push(`${email}: ${result.output.slice(0, 160)}`);
      continue;
    }
    if (dryRun) {
      sent += 1;
      continue;
    }

    const commitValues = {
      Status: "Outreach Sent",
      "Date First Contacted": todayET(),
      "Email Copy Sent": existingCopy ? `${existingCopy}\n\n---\n${body}` : body,
      Notes: `${notesNow}\nSent initial outreach ${todayET()} ET.`.trim(),
    };
    try {
      const props = buildProperties(IDS.b2bProspects, commitValues);
      await updatePage(freshRow.id, props);
    } catch (err) {
      queueSendReconcile({
        dbId: IDS.b2bProspects,
        pageId: freshRow.id,
        prospectType: "b2b",
        email,
        values: commitValues,
        sourceAgent: "agent3",
      });
      queuedNotionSync += 1;
      failures.push(`${email}: post_send_notion_update_queued`);
    }
    sentHistory.add(email);
    sent += 1;
  }

  const sentTodayAfter = sentTodayBefore + sent;
  const shortfall = Math.max(0, SEND_POLICY.b2bFloorPerDay - sentTodayAfter);
  const floorMet = shortfall === 0;
  let status = failures.length ? (sent > 0 ? "Partial" : "Failed") : "Success";
  if (!dryRun && !floorMet) status = sentTodayAfter > 0 ? "Partial" : "Failed";
  if (!dryRun && !floorMet) failures.push(`quota_floor_shortfall:${shortfall}`);
  await logRun({
    agentName: "Agent 3 — B2B Email Sender",
    recordsProcessed: candidates.length,
    emailsSent: sent,
    errors: failures.join(" | "),
    status,
    notes: dryRun
      ? `Dry run enabled. Requested ${requested}; sent_today_before ${sentTodayBefore}; remaining_floor ${remainingFloor}; remaining_hard_allowance ${remainingHardAllowance}; projected_shortfall ${shortfall}.`
      : `Requested ${requested}; sent_today_before ${sentTodayBefore}; sent_now ${sent}; sent_today_after ${sentTodayAfter}; daily_floor ${SEND_POLICY.b2bFloorPerDay}; hard_max ${hardMax}; shortfall ${shortfall}; blocked_unverified ${blockedUnverified}; blocked_no_resend ${blockedDuplicate}; send_failures ${sendFailures}; queued_notion_sync ${queuedNotionSync}; reconciled_now ${reconcileBefore.resolvedNow}; reconcile_pending ${reconcileBefore.stillPending}.`,
  });

  return {
    selected: candidates.length,
    sent,
    requested,
    sentTodayBefore,
    sentTodayAfter,
    remainingFloor,
    remainingHardAllowance,
    floorTarget,
    hardMax,
    shortfall,
    floorMet,
    blockedUnverified,
    blockedDuplicate,
    sendFailures,
    queuedNotionSync,
    reconcileBefore,
    failures,
    status,
  };
}

async function runDistributorEmailSender(limit = 10, dryRun = false) {
  const requested = Math.max(0, Number(limit || 0));
  const sentTodayBefore = sumAgentSendsForDate("agent4", todayET());
  const remainingFloor = Math.max(0, SEND_POLICY.distributorFloorPerDay - sentTodayBefore);
  const floorTarget = Math.max(requested, remainingFloor);
  const hardMax = SEND_POLICY.distributorHardMaxPerDay;
  const remainingHardAllowance = Math.max(0, hardMax - sentTodayBefore);
  const pullCount = Math.max(0, Math.min(remainingHardAllowance, floorTarget));
  const [rows, b2bRows] = await Promise.all([
    queryDatabaseAll(IDS.distributorProspects),
    queryDatabaseAll(IDS.b2bProspects),
  ]);
  const b2bIndex = buildEmailStatusIndex(b2bRows, "Email", false);
  const candidates = rows
    .filter((r) => {
      const status = getPlainText(getPropByName(r, "Status", "Outreach Status"));
      const email = normalizeEmail(getPlainText(getPropByName(r, "Email")));
      return status === "New - Uncontacted" && Boolean(email);
    })
    .sort((a, b) => {
      const da = Number(getPlainText(getPropByName(a, "Distance from Repacker", "Miles from Nearest Repacker"))) || 99999;
      const db = Number(getPlainText(getPropByName(b, "Distance from Repacker", "Miles from Nearest Repacker"))) || 99999;
      return da - db;
    })
    .slice(0, pullCount);

  let sent = 0;
  let blockedUnverified = 0;
  let blockedDuplicate = 0;
  let queuedNotionSync = 0;
  let sendFailures = 0;
  const failures = [];
  const sentHistory = loadRecentSentEmailSet();
  const reconcileBefore = dryRun
    ? { pendingBefore: 0, resolvedNow: 0, failedNow: 0, stillPending: 0 }
    : await reconcilePendingSendCommits(120);

  for (const row of candidates) {
    const freshRow = await getPage(row.id);
    const email = normalizeEmail(getPlainText(getPropByName(freshRow, "Email")));
    if (!email) continue;

    const statusNow = getPlainText(getPropByName(freshRow, "Status", "Outreach Status"));
    const firstContacted = getPlainText(getPropByName(freshRow, "Date First Contacted"));
    const existingCopy = getPlainText(getPropByName(freshRow, "Email Copy Sent"));
    const notesNow = getPlainText(getPropByName(freshRow, "Notes"));

    if (statusNow !== "New - Uncontacted") {
      failures.push(`${email}: blocked_not_new`);
      blockedDuplicate += 1;
      continue;
    }

    if (isCrossDbAlreadyTouched(b2bIndex, email)) {
      const flagged = appendTaggedNote(
        notesNow,
        "send-guard-cross-db",
        `${todayET()} ET: blocked initial send. Same email exists in B2B CRM with outreach activity.`
      );
      await updatePage(
        freshRow.id,
        buildProperties(IDS.distributorProspects, {
          Notes: flagged.text,
        })
      );
      failures.push(`${email}: blocked_cross_db_touched`);
      blockedDuplicate += 1;
      continue;
    }

    const resendCheck = buildNoResendDecision({
      status: statusNow,
      dateFirstContacted: firstContacted,
      emailCopySent: existingCopy,
      email,
      sentHistory,
    });
    if (resendCheck.blocked) {
      const updates = {
        Notes: `${notesNow}\nSend blocked ${todayET()} ET: no-resend guard (${resendCheck.reasons.join(",")}).`.trim(),
      };
      if (statusNow === "New - Uncontacted" && resendCheck.shouldPromoteToOutreach) {
        updates.Status = "Outreach Sent";
      }
      await updatePage(freshRow.id, buildProperties(IDS.distributorProspects, updates));
      failures.push(`${email}: blocked_no_resend_${resendCheck.reasons.join("+")}`);
      blockedDuplicate += 1;
      continue;
    }

    const verification = await verifyBusinessEmail(email);
    if (!verification.ok) {
      const updates = {
        Notes: `${notesNow}\nSend blocked ${todayET()} ET: unverified email (${verification.reason}).`.trim(),
      };
      if (isHardVerificationFailure(verification.reason)) {
        updates.Status = "Bounced";
      }
      await updatePage(freshRow.id, buildProperties(IDS.distributorProspects, updates));
      failures.push(`${email}: blocked_unverified_${verification.reason}`);
      blockedUnverified += 1;
      continue;
    }
    const contactName = getPlainText(getPropByName(freshRow, "Contact Name", "Primary Contact Name"));
    const company = getPlainText(getPropByName(freshRow, "Company Name"));
    const firstName = getFirstName(contactName);

    const subject = TEMPLATE_LIBRARY.distributorInitial.subject;
    const body = renderTemplate(TEMPLATE_LIBRARY.distributorInitial.body, {
      "First Name": firstName,
      "Business Name": company,
    });

    if (!dryRun) {
      const intentNote = buildSendIntentNote(notesNow, email, subject);
      try {
        await updatePage(
          freshRow.id,
          buildProperties(IDS.distributorProspects, {
            Notes: intentNote,
          })
        );
      } catch (err) {
        failures.push(`${email}: send_intent_failed_${String(err?.message || err).slice(0, 80)}`);
        continue;
      }
    }

    const result = sendEmail({ to: email, subject, body, dryRun });
    if (!result.ok) {
      sendFailures += 1;
      failures.push(`${email}: ${result.output.slice(0, 160)}`);
      continue;
    }
    if (dryRun) {
      sent += 1;
      continue;
    }

    const commitValues = {
      Status: "Outreach Sent",
      "Date First Contacted": todayET(),
      "Email Copy Sent": existingCopy ? `${existingCopy}\n\n---\n${body}` : body,
      Notes: `${notesNow}\nSent initial outreach ${todayET()} ET.`.trim(),
    };
    try {
      const props = buildProperties(IDS.distributorProspects, commitValues);
      await updatePage(freshRow.id, props);
    } catch (err) {
      queueSendReconcile({
        dbId: IDS.distributorProspects,
        pageId: freshRow.id,
        prospectType: "distributor",
        email,
        values: commitValues,
        sourceAgent: "agent4",
      });
      queuedNotionSync += 1;
      failures.push(`${email}: post_send_notion_update_queued`);
    }
    sentHistory.add(email);
    sent += 1;
  }

  const sentTodayAfter = sentTodayBefore + sent;
  const shortfall = Math.max(0, SEND_POLICY.distributorFloorPerDay - sentTodayAfter);
  const floorMet = shortfall === 0;
  let status = failures.length ? (sent > 0 ? "Partial" : "Failed") : "Success";
  if (!dryRun && !floorMet) status = sentTodayAfter > 0 ? "Partial" : "Failed";
  if (!dryRun && !floorMet) failures.push(`quota_floor_shortfall:${shortfall}`);
  await logRun({
    agentName: "Agent 4 — Distributor Email Sender",
    recordsProcessed: candidates.length,
    emailsSent: sent,
    errors: failures.join(" | "),
    status,
    notes: dryRun
      ? `Dry run enabled. Requested ${requested}; sent_today_before ${sentTodayBefore}; remaining_floor ${remainingFloor}; remaining_hard_allowance ${remainingHardAllowance}; projected_shortfall ${shortfall}.`
      : `Requested ${requested}; sent_today_before ${sentTodayBefore}; sent_now ${sent}; sent_today_after ${sentTodayAfter}; daily_floor ${SEND_POLICY.distributorFloorPerDay}; hard_max ${hardMax}; shortfall ${shortfall}; blocked_unverified ${blockedUnverified}; blocked_no_resend ${blockedDuplicate}; send_failures ${sendFailures}; queued_notion_sync ${queuedNotionSync}; reconciled_now ${reconcileBefore.resolvedNow}; reconcile_pending ${reconcileBefore.stillPending}.`,
  });

  return {
    selected: candidates.length,
    sent,
    requested,
    sentTodayBefore,
    sentTodayAfter,
    remainingFloor,
    remainingHardAllowance,
    floorTarget,
    hardMax,
    shortfall,
    floorMet,
    blockedUnverified,
    blockedDuplicate,
    sendFailures,
    queuedNotionSync,
    reconcileBefore,
    failures,
    status,
  };
}

async function runEmailAudit() {
  const b2bRows = await queryDatabaseAll(IDS.b2bProspects);
  const distRows = await queryDatabaseAll(IDS.distributorProspects);

  let reviewed = 0;
  let cleared = 0;
  const reasons = {};

  for (const row of b2bRows) {
    const status = getPlainText(getPropByName(row, "Status", "Outreach Status"));
    if (status !== "New - Uncontacted") continue;
    const email = normalizeEmail(getPlainText(getPropByName(row, "Email", "Email Address")));
    if (!email) continue;
    reviewed += 1;
    const notesNow = getPlainText(getPropByName(row, "Notes"));
    if (!notesNow.includes("Email source:")) {
      reasons.legacy_missing_source = (reasons.legacy_missing_source || 0) + 1;
      const notes = `${notesNow}\nEmail audit ${todayET()} ET: missing source evidence; retained for manual verification.`.trim();
      await updatePage(row.id, buildProperties(IDS.b2bProspects, { Notes: notes }));
    }
    const verification = await verifyBusinessEmail(email);
    if (verification.ok) continue;
    reasons[verification.reason] = (reasons[verification.reason] || 0) + 1;
    const updates = {
      Notes: `${notesNow}\nEmail audit ${todayET()} ET: marked as bounced/unverified (${verification.reason}).`.trim(),
    };
    if (isHardVerificationFailure(verification.reason)) updates.Status = "Bounced";
    await updatePage(row.id, buildProperties(IDS.b2bProspects, updates));
    cleared += 1;
  }

  for (const row of distRows) {
    const status = getPlainText(getPropByName(row, "Status", "Outreach Status"));
    if (status !== "New - Uncontacted") continue;
    const email = normalizeEmail(getPlainText(getPropByName(row, "Email")));
    if (!email) continue;
    reviewed += 1;
    const notesNow = getPlainText(getPropByName(row, "Notes"));
    if (!notesNow.includes("Email source:")) {
      reasons.legacy_missing_source = (reasons.legacy_missing_source || 0) + 1;
      const notes = `${notesNow}\nEmail audit ${todayET()} ET: missing source evidence; retained for manual verification.`.trim();
      await updatePage(row.id, buildProperties(IDS.distributorProspects, { Notes: notes }));
    }
    const verification = await verifyBusinessEmail(email);
    if (verification.ok) continue;
    reasons[verification.reason] = (reasons[verification.reason] || 0) + 1;
    const updates = {
      Notes: `${notesNow}\nEmail audit ${todayET()} ET: marked as bounced/unverified (${verification.reason}).`.trim(),
    };
    if (isHardVerificationFailure(verification.reason)) updates.Status = "Bounced";
    await updatePage(row.id, buildProperties(IDS.distributorProspects, updates));
    cleared += 1;
  }

  const reasonSummary = Object.entries(reasons)
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");
  await logRun({
    agentName: "Data Quality — Email Audit",
    recordsProcessed: reviewed,
    emailsSent: 0,
    errors: "",
    status: "Success",
    notes: `Reviewed ${reviewed}; cleared ${cleared}${reasonSummary ? `; reasons ${reasonSummary}` : ""}.`,
  });

  return { reviewed, cleared, reasons };
}

async function runNoResendGuardAgent(limit = 600) {
  const [b2bRows, distRows] = await Promise.all([queryDatabaseAll(IDS.b2bProspects), queryDatabaseAll(IDS.distributorProspects)]);
  const sentHistory = loadRecentSentEmailSet();
  const errors = [];
  let reviewed = 0;
  let correctedB2B = 0;
  let correctedDist = 0;
  let sendLogBlocks = 0;

  const reviewRows = async (rows, dbId, emailField, label) => {
    for (const row of rows.slice(0, limit)) {
      const email = normalizeEmail(getPlainText(getPropByName(row, emailField)));
      if (!email) continue;
      reviewed += 1;
      const status = getPlainText(getPropByName(row, "Status", "Outreach Status"));
      const firstContacted = getPlainText(getPropByName(row, "Date First Contacted"));
      const existingCopy = getPlainText(getPropByName(row, "Email Copy Sent"));
      if (status !== "New - Uncontacted") continue;
      const decision = buildNoResendDecision({
        status,
        dateFirstContacted: firstContacted,
        emailCopySent: existingCopy,
        email,
        sentHistory,
      });
      if (!decision.blocked || !decision.shouldPromoteToOutreach) continue;

      if (decision.reasons.includes("send_log_recent")) sendLogBlocks += 1;
      const notes = `${getPlainText(getPropByName(row, "Notes"))}\nNo-resend guard ${todayET()} ET: moved to Outreach Sent (${decision.reasons.join(",")}).`.trim();
      try {
        await updatePage(
          row.id,
          buildProperties(dbId, {
            Status: "Outreach Sent",
            Notes: notes,
          })
        );
        if (label === "b2b") correctedB2B += 1;
        if (label === "dist") correctedDist += 1;
      } catch (err) {
        errors.push(String(err?.message || err).slice(0, 180));
      }
    }
  };

  await reviewRows(b2bRows, IDS.b2bProspects, "Email", "b2b");
  await reviewRows(distRows, IDS.distributorProspects, "Email", "dist");

  const status = errors.length ? (reviewed > 0 ? "Partial" : "Failed") : "Success";
  await logRun({
    agentName: "Agent 18 — No-Resend Guard",
    recordsProcessed: reviewed,
    emailsSent: 0,
    errors: errors.join(" | "),
    status,
    notes: `Reviewed ${reviewed}; corrected_b2b ${correctedB2B}; corrected_distributor ${correctedDist}; send_log_blocks ${sendLogBlocks}.`,
  });

  return {
    reviewed,
    correctedB2B,
    correctedDist,
    sendLogBlocks,
    errors,
    status,
  };
}

async function runNotionMasterSyncAgent(limit = 800) {
  const reconcile = await reconcilePendingSendCommits(300);
  const [b2bRows, distRows] = await Promise.all([queryDatabaseAll(IDS.b2bProspects), queryDatabaseAll(IDS.distributorProspects)]);
  const duplicateMap = new Map();
  const register = (email, scope) => {
    if (!email) return;
    const key = normalizeEmail(email);
    if (!duplicateMap.has(key)) {
      duplicateMap.set(key, { count: 0, scopes: new Set() });
    }
    const meta = duplicateMap.get(key);
    meta.count += 1;
    meta.scopes.add(scope);
  };

  for (const row of b2bRows) register(getPlainText(getPropByName(row, "Email", "Email Address")), "b2b");
  for (const row of distRows) register(getPlainText(getPropByName(row, "Email")), "distributor");

  const b2bIndex = buildEmailStatusIndex(b2bRows, "Email", false);
  const distIndex = buildEmailStatusIndex(distRows, "Email", true);
  const errors = [];
  let reviewed = 0;
  let correctedStatus = 0;
  let flaggedMissingSource = 0;
  let flaggedMissingEvidence = 0;
  let flaggedDuplicates = 0;
  let flaggedCrossDb = 0;

  const reviewRows = async (rows, options) => {
    const {
      dbId,
      emailField,
      scopeLabel,
      otherIndex,
    } = options;
    for (const row of rows.slice(0, limit)) {
      reviewed += 1;
      const email = normalizeEmail(getPlainText(getPropByName(row, emailField, "Email Address")));
      const statusNow = getPlainText(getPropByName(row, "Status", "Outreach Status"));
      const sourceNow = getPlainText(getPropByName(row, "Source"));
      const notesNow = getPlainText(getPropByName(row, "Notes"));
      let nextNotes = notesNow;
      const updates = {};

      if (statusNow === "New - Uncontacted" && hasSendEvidence(row)) {
        updates.Status = "Outreach Sent";
        correctedStatus += 1;
      }

      if (!String(sourceNow || "").trim()) {
        const flagged = appendTaggedNote(
          nextNotes,
          "master-sync-missing-source",
          `${todayET()} ET: missing Source. Keep blocked until source evidence is captured.`
        );
        nextNotes = flagged.text;
        if (flagged.added) flaggedMissingSource += 1;
      }

      if (!/Website:\s*\S+/i.test(nextNotes)) {
        const flagged = appendTaggedNote(
          nextNotes,
          "master-sync-missing-evidence",
          `${todayET()} ET: missing website evidence in Notes. Add homepage/contact URL before outreach.`
        );
        nextNotes = flagged.text;
        if (flagged.added) flaggedMissingEvidence += 1;
      }

      const duplicate = email ? duplicateMap.get(email) : null;
      if (duplicate && duplicate.count > 1) {
        const flagged = appendTaggedNote(
          nextNotes,
          "master-sync-duplicate",
          `${todayET()} ET: duplicate email present (${duplicate.count} records across ${[...duplicate.scopes].join("+")}).`
        );
        nextNotes = flagged.text;
        if (flagged.added) flaggedDuplicates += 1;
      }

      if (email && isCrossDbAlreadyTouched(otherIndex, email)) {
        const flagged = appendTaggedNote(
          nextNotes,
          "master-sync-cross-db",
          `${todayET()} ET: same email has outreach activity in ${scopeLabel === "b2b" ? "Distributor" : "B2B"} CRM.`
        );
        nextNotes = flagged.text;
        if (flagged.added) flaggedCrossDb += 1;
      }

      if (nextNotes !== notesNow) updates.Notes = nextNotes;
      if (Object.keys(updates).length === 0) continue;
      try {
        await updatePage(row.id, buildProperties(dbId, updates));
      } catch (err) {
        errors.push(String(err?.message || err).slice(0, 180));
      }
    }
  };

  await reviewRows(b2bRows, {
    dbId: IDS.b2bProspects,
    emailField: "Email",
    scopeLabel: "b2b",
    otherIndex: distIndex,
  });
  await reviewRows(distRows, {
    dbId: IDS.distributorProspects,
    emailField: "Email",
    scopeLabel: "distributor",
    otherIndex: b2bIndex,
  });

  const status = errors.length ? (reviewed > 0 ? "Partial" : "Failed") : "Success";
  await logRun({
    agentName: "Agent 19 — Notion Master Sync",
    recordsProcessed: reviewed,
    emailsSent: 0,
    errors: errors.join(" | "),
    status,
    notes: `Reviewed ${reviewed}; corrected_status ${correctedStatus}; flagged_missing_source ${flaggedMissingSource}; flagged_missing_evidence ${flaggedMissingEvidence}; flagged_duplicates ${flaggedDuplicates}; flagged_cross_db ${flaggedCrossDb}; reconcile_resolved ${reconcile.resolvedNow}; reconcile_failed ${reconcile.failedNow}; reconcile_pending ${reconcile.stillPending}.`,
  });

  return {
    reconcile,
    reviewed,
    correctedStatus,
    flaggedMissingSource,
    flaggedMissingEvidence,
    flaggedDuplicates,
    flaggedCrossDb,
    errors,
    status,
  };
}

async function runSendQueueGateAgent(limit = 600) {
  const [b2bRows, distRows] = await Promise.all([queryDatabaseAll(IDS.b2bProspects), queryDatabaseAll(IDS.distributorProspects)]);
  const sentHistory = loadRecentSentEmailSet();
  const deliverabilityGuard = loadDeliverabilityGuard();
  const b2bIndex = buildEmailStatusIndex(b2bRows, "Email", false);
  const distIndex = buildEmailStatusIndex(distRows, "Email", true);
  const errors = [];
  let reviewed = 0;
  let readyB2B = 0;
  let readyDist = 0;
  let blockedNoResend = 0;
  let blockedUnverified = 0;
  let blockedCrossDb = 0;
  let blockedDeliverability = 0;

  const reviewRows = async (rows, options) => {
    const {
      dbId,
      emailField,
      isDistributor,
      otherIndex,
    } = options;
    const perDbLimit = Math.max(1, Math.floor(limit / 2));
    for (const row of rows.slice(0, perDbLimit)) {
      const email = normalizeEmail(getPlainText(getPropByName(row, emailField, "Email Address")));
      const statusNow = getPlainText(getPropByName(row, "Status", "Outreach Status"));
      if (!email || statusNow !== "New - Uncontacted") continue;
      reviewed += 1;

      const firstContacted = getPlainText(getPropByName(row, "Date First Contacted"));
      const existingCopy = getPlainText(getPropByName(row, "Email Copy Sent"));
      const notesNow = getPlainText(getPropByName(row, "Notes"));
      const updates = {};

      const resendDecision = buildNoResendDecision({
        status: statusNow,
        dateFirstContacted: firstContacted,
        emailCopySent: existingCopy,
        email,
        sentHistory,
      });
      if (resendDecision.blocked) {
        updates.Notes = `${notesNow}\nSend queue gate ${todayET()} ET: blocked no-resend (${resendDecision.reasons.join(",")}).`.trim();
        if (resendDecision.shouldPromoteToOutreach) updates.Status = "Outreach Sent";
        blockedNoResend += 1;
        try {
          await updatePage(row.id, buildProperties(dbId, updates));
        } catch (err) {
          errors.push(String(err?.message || err).slice(0, 180));
        }
        continue;
      }

      if (isCrossDbAlreadyTouched(otherIndex, email)) {
        const flagged = appendTaggedNote(
          notesNow,
          "send-gate-cross-db",
          `${todayET()} ET: blocked. Same email has outreach activity in the other CRM.`
        );
        blockedCrossDb += 1;
        try {
          await updatePage(
            row.id,
            buildProperties(dbId, {
              Notes: flagged.text,
            })
          );
        } catch (err) {
          errors.push(String(err?.message || err).slice(0, 180));
        }
        continue;
      }

      const domain = emailDomain(email);
      if (isDomainBlockedByDeliverability(domain, deliverabilityGuard)) {
        blockedDeliverability += 1;
        const flagged = appendTaggedNote(
          notesNow,
          "send-gate-deliverability",
          `${todayET()} ET: blocked by deliverability guard for domain ${domain}.`
        );
        try {
          await updatePage(
            row.id,
            buildProperties(dbId, {
              Notes: flagged.text,
            })
          );
        } catch (err) {
          errors.push(String(err?.message || err).slice(0, 180));
        }
        continue;
      }

      const verification = await verifyBusinessEmail(email);
      if (!verification.ok) {
        blockedUnverified += 1;
        const blockedUpdates = {
          Notes: `${notesNow}\nSend queue gate ${todayET()} ET: unverified email (${verification.reason}).`.trim(),
        };
        if (isHardVerificationFailure(verification.reason)) blockedUpdates.Status = "Bounced";
        try {
          await updatePage(row.id, buildProperties(dbId, blockedUpdates));
        } catch (err) {
          errors.push(String(err?.message || err).slice(0, 180));
        }
        continue;
      }

      if (isDistributor) readyDist += 1;
      else readyB2B += 1;
    }
  };

  await reviewRows(b2bRows, {
    dbId: IDS.b2bProspects,
    emailField: "Email",
    isDistributor: false,
    otherIndex: distIndex,
  });
  await reviewRows(distRows, {
    dbId: IDS.distributorProspects,
    emailField: "Email",
    isDistributor: true,
    otherIndex: b2bIndex,
  });

  const status = errors.length ? (reviewed > 0 ? "Partial" : "Failed") : "Success";
  await logRun({
    agentName: "Agent 20 — Send Queue Gate",
    recordsProcessed: reviewed,
    emailsSent: 0,
    errors: errors.join(" | "),
    status,
    notes: `Reviewed ${reviewed}; ready_b2b ${readyB2B}; ready_distributor ${readyDist}; blocked_no_resend ${blockedNoResend}; blocked_unverified ${blockedUnverified}; blocked_cross_db ${blockedCrossDb}; blocked_deliverability ${blockedDeliverability}.`,
  });

  return {
    reviewed,
    readyB2B,
    readyDist,
    blockedNoResend,
    blockedUnverified,
    blockedCrossDb,
    blockedDeliverability,
    errors,
    status,
  };
}

function estimateSendReady(rows, options) {
  const {
    emailField,
    isDistributor,
    sentHistory,
    deliverabilityGuard,
    otherIndex,
  } = options;
  let ready = 0;
  for (const row of rows) {
    const status = getPlainText(getPropByName(row, "Status", "Outreach Status"));
    if (status !== "New - Uncontacted") continue;
    const email = normalizeEmail(getPlainText(getPropByName(row, emailField, "Email Address")));
    if (!email) continue;
    if (isCrossDbAlreadyTouched(otherIndex, email)) continue;
    if (isDomainBlockedByDeliverability(emailDomain(email), deliverabilityGuard)) continue;
    const resend = buildNoResendDecision({
      status,
      dateFirstContacted: getPlainText(getPropByName(row, "Date First Contacted")),
      emailCopySent: getPlainText(getPropByName(row, "Email Copy Sent")),
      email,
      sentHistory,
    });
    if (resend.blocked) continue;
    ready += 1;
  }
  return ready;
}

async function runPipelinePulseAgent(dryRun = false) {
  const sentHistory = loadRecentSentEmailSet();
  const deliverabilityGuard = loadDeliverabilityGuard();
  const [b2bRows, distRows] = await Promise.all([queryDatabaseAll(IDS.b2bProspects), queryDatabaseAll(IDS.distributorProspects)]);
  const b2bIndex = buildEmailStatusIndex(b2bRows, "Email", false);
  const distIndex = buildEmailStatusIndex(distRows, "Email", true);

  const b2bReadyBefore = estimateSendReady(b2bRows, {
    emailField: "Email",
    isDistributor: false,
    sentHistory,
    deliverabilityGuard,
    otherIndex: distIndex,
  });
  const distReadyBefore = estimateSendReady(distRows, {
    emailField: "Email",
    isDistributor: true,
    sentHistory,
    deliverabilityGuard,
    otherIndex: b2bIndex,
  });

  const targetB2BReady = SEND_POLICY.b2bFloorPerDay * PIPELINE_POLICY.b2bReadyBufferMultiple;
  const targetDistReady = SEND_POLICY.distributorFloorPerDay * PIPELINE_POLICY.distributorReadyBufferMultiple;
  const b2bShortfall = Math.max(0, targetB2BReady - b2bReadyBefore);
  const distShortfall = Math.max(0, targetDistReady - distReadyBefore);
  const actions = [];
  const ledger = loadRunLedger();
  const b2bZeroStreak = consecutiveZeroAddRuns(ledger, "agent1", 6);
  const distZeroStreak = consecutiveZeroAddRuns(ledger, "agent2", 6);

  if (!dryRun && (b2bShortfall > 0 || distShortfall > 0)) {
    if (b2bShortfall > 0) {
      const target = Math.max(PIPELINE_POLICY.b2bMinResearchTopUp, b2bShortfall + 4);
      const result = await runSingleAgentWithMonitoring("agent1", () => runB2BResearcher(target), {
        source: "agent21-pipeline-pulse",
      });
      actions.push(`agent1:add=${result?.added ?? 0}`);
      if (Number(result?.added || 0) === 0 || b2bZeroStreak >= 2) {
        const recoveryTarget = clampNumber(Math.max(target + 10, 18), 18, 90);
        const recovery = await runSingleAgentWithMonitoring(
          "agent1",
          () => runB2BResearcher(recoveryTarget, { recovery: true }),
          {
            source: "agent21-pipeline-pulse-recovery",
          }
        );
        actions.push(`agent1-recovery:add=${recovery?.added ?? 0}`);
      }
    }
    if (distShortfall > 0) {
      const target = Math.max(PIPELINE_POLICY.distributorMinResearchTopUp, distShortfall + 2);
      const result = await runSingleAgentWithMonitoring("agent2", () => runDistributorResearcher(target), {
        source: "agent21-pipeline-pulse",
      });
      actions.push(`agent2:add=${result?.added ?? 0}`);
      if (Number(result?.added || 0) === 0 || distZeroStreak >= 2) {
        const recoveryTarget = clampNumber(Math.max(target + 6, 10), 10, 45);
        const recovery = await runSingleAgentWithMonitoring(
          "agent2",
          () => runDistributorResearcher(recoveryTarget, { recovery: true }),
          {
            source: "agent21-pipeline-pulse-recovery",
          }
        );
        actions.push(`agent2-recovery:add=${recovery?.added ?? 0}`);
      }
    }
    const verifier = await runSingleAgentWithMonitoring("agent12", () => runBalancedContactVerifierAgent(250), {
      source: "agent21-pipeline-pulse",
    });
    actions.push(`agent12:reviewed=${verifier?.reviewed ?? 0}`);
    const audit = await runSingleAgentWithMonitoring("agent0", () => runEmailAudit(), {
      source: "agent21-pipeline-pulse",
    });
    actions.push(`agent0:reviewed=${audit?.reviewed ?? 0}`);
    const noResend = await runSingleAgentWithMonitoring("agent18", () => runNoResendGuardAgent(600), {
      source: "agent21-pipeline-pulse",
    });
    actions.push(`agent18:reviewed=${noResend?.reviewed ?? 0}`);
    const gate = await runSingleAgentWithMonitoring("agent20", () => runSendQueueGateAgent(600), {
      source: "agent21-pipeline-pulse",
    });
    actions.push(`agent20:ready=${(gate?.readyB2B || 0) + (gate?.readyDist || 0)}`);
  }

  const [b2bAfter, distAfter] = await Promise.all([queryDatabaseAll(IDS.b2bProspects), queryDatabaseAll(IDS.distributorProspects)]);
  const b2bIndexAfter = buildEmailStatusIndex(b2bAfter, "Email", false);
  const distIndexAfter = buildEmailStatusIndex(distAfter, "Email", true);
  const b2bReadyAfter = estimateSendReady(b2bAfter, {
    emailField: "Email",
    isDistributor: false,
    sentHistory,
    deliverabilityGuard,
    otherIndex: distIndexAfter,
  });
  const distReadyAfter = estimateSendReady(distAfter, {
    emailField: "Email",
    isDistributor: true,
    sentHistory,
    deliverabilityGuard,
    otherIndex: b2bIndexAfter,
  });

  const status = b2bReadyAfter >= targetB2BReady && distReadyAfter >= targetDistReady ? "Success" : "Partial";
  await logRun({
    agentName: "Agent 21 — Pipeline Pulse",
    recordsProcessed: b2bAfter.length + distAfter.length,
    emailsSent: 0,
    errors: "",
    status,
    notes: `ready_before b2b=${b2bReadyBefore}/${targetB2BReady} distributor=${distReadyBefore}/${targetDistReady}; ready_after b2b=${b2bReadyAfter}/${targetB2BReady} distributor=${distReadyAfter}/${targetDistReady}; actions=${actions.join(",") || "none"}; dry_run=${dryRun ? "yes" : "no"}.`,
  });

  return {
    dryRun,
    targetB2BReady,
    targetDistReady,
    b2bReadyBefore,
    distReadyBefore,
    b2bReadyAfter,
    distReadyAfter,
    b2bShortfall,
    distShortfall,
    b2bZeroStreak,
    distZeroStreak,
    actions,
    status,
  };
}

function emailDomain(email) {
  return extractEmailParts(normalizeEmail(email)).domain;
}

function topEntries(map, limit = 10) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

async function runCustomerLearningAgent() {
  const [b2bRows, distRows] = await Promise.all([queryDatabaseAll(IDS.b2bProspects), queryDatabaseAll(IDS.distributorProspects)]);

  const b2bInterestedStates = {};
  const b2bInterestedTypes = {};
  const b2bInterestedDomains = {};
  const b2bOutreachByType = {};
  const b2bInterestedByType = {};

  for (const row of b2bRows) {
    const status = getPlainText(getPropByName(row, "Status", "Outreach Status"));
    const state = getPlainText(getPropByName(row, "State")) || "(unknown)";
    const type = getPlainText(getPropByName(row, "Business Type")) || "Other";
    const email = getPlainText(getPropByName(row, "Email", "Email Address"));
    const domain = emailDomain(email) || "(unknown)";
    const reached = ["Outreach Sent", "Follow-Up Sent", "Replied - Interested", "Replied - Not Interested", "Order Placed"].includes(status);
    const interested = status === "Replied - Interested" || status === "Order Placed";
    if (reached) b2bOutreachByType[type] = (b2bOutreachByType[type] || 0) + 1;
    if (interested) {
      b2bInterestedStates[state] = (b2bInterestedStates[state] || 0) + 1;
      b2bInterestedTypes[type] = (b2bInterestedTypes[type] || 0) + 1;
      b2bInterestedDomains[domain] = (b2bInterestedDomains[domain] || 0) + 1;
      b2bInterestedByType[type] = (b2bInterestedByType[type] || 0) + 1;
    }
  }

  const distInterestedStates = {};
  const distInterestedDomains = {};
  const distOutreachByState = {};
  const distInterestedByState = {};
  for (const row of distRows) {
    const status = getPlainText(getPropByName(row, "Status", "Outreach Status"));
    const state = getPlainText(getPropByName(row, "State")) || "(unknown)";
    const email = getPlainText(getPropByName(row, "Email"));
    const domain = emailDomain(email) || "(unknown)";
    const reached = ["Outreach Sent", "Follow-Up Sent", "Replied - Interested", "Replied - Not Interested", "Contract Discussion", "Contract Signed"].includes(status);
    const interested = ["Replied - Interested", "Contract Discussion", "Contract Signed"].includes(status);
    if (reached) distOutreachByState[state] = (distOutreachByState[state] || 0) + 1;
    if (interested) {
      distInterestedStates[state] = (distInterestedStates[state] || 0) + 1;
      distInterestedDomains[domain] = (distInterestedDomains[domain] || 0) + 1;
      distInterestedByState[state] = (distInterestedByState[state] || 0) + 1;
    }
  }

  const topB2BTypes = topEntries(b2bInterestedTypes, 5);
  const topB2BStates = topEntries(b2bInterestedStates, 5);
  const topDistStates = topEntries(distInterestedStates, 5);
  const topDomains = topEntries(
    Object.fromEntries(
      Object.entries({ ...b2bInterestedDomains, ...distInterestedDomains }).map(([k, v]) => [
        k,
        (b2bInterestedDomains[k] || 0) + (distInterestedDomains[k] || 0),
      ])
    ),
    8
  );

  const b2bTypeRates = topEntries(
    Object.fromEntries(
      Object.keys(b2bOutreachByType).map((type) => [type, pct(b2bInterestedByType[type] || 0, b2bOutreachByType[type] || 0)])
    ),
    6
  );
  const distStateRates = topEntries(
    Object.fromEntries(
      Object.keys(distOutreachByState).map((state) => [state, pct(distInterestedByState[state] || 0, distOutreachByState[state] || 0)])
    ),
    6
  );

  const title = `${todayLongET()} — Customer Learning Report`;
  const blocks = [
    blockHeading("B2B ICP Signals"),
    blockParagraph(`Top interested business types: ${topB2BTypes.map(([k, v]) => `${k} (${v})`).join(", ") || "none yet"}`),
    blockParagraph(`Top interested B2B states: ${topB2BStates.map(([k, v]) => `${k} (${v})`).join(", ") || "none yet"}`),
    blockParagraph(`B2B type response rates: ${b2bTypeRates.map(([k, v]) => `${k} ${v}%`).join(", ") || "insufficient data"}`),
    blockHeading("Distributor ICP Signals"),
    blockParagraph(`Top interested distributor states: ${topDistStates.map(([k, v]) => `${k} (${v})`).join(", ") || "none yet"}`),
    blockParagraph(`Distributor state response rates: ${distStateRates.map(([k, v]) => `${k} ${v}%`).join(", ") || "insufficient data"}`),
    blockHeading("Domain-Level Signal"),
    blockParagraph(`Top domains among interested replies: ${topDomains.map(([k, v]) => `${k} (${v})`).join(", ") || "none yet"}`),
    blockHeading("Actionable Priorities"),
    blockParagraph("Prioritize outbound on the top-performing B2B types and states first."),
    blockParagraph("For distributors, concentrate outreach near repacker hubs with the highest interest-rate states."),
    blockParagraph("Feed this report into tomorrow's agent query mix before sending."),
  ];

  await createPageInDb(IDS.dailyReports, buildProperties(IDS.dailyReports, { Name: title }), blocks);
  await logRun({
    agentName: "Agent 8 — Customer Learning",
    recordsProcessed: b2bRows.length + distRows.length,
    emailsSent: 0,
    errors: "",
    status: "Success",
    notes: `Published ${title}.`,
  });

  return {
    title,
    topB2BTypes,
    topB2BStates,
    topDistStates,
    topDomains,
  };
}

async function runBounceIntelligenceAgent() {
  const [b2bRows, distRows] = await Promise.all([queryDatabaseAll(IDS.b2bProspects), queryDatabaseAll(IDS.distributorProspects)]);
  const bounceDomains = {};
  const bounceSources = {};

  const collect = (row, emailField, sourceField) => {
    const status = getPlainText(getPropByName(row, "Status", "Outreach Status"));
    if (status !== "Bounced") return;
    const email = getPlainText(getPropByName(row, emailField));
    const domain = emailDomain(email) || "(unknown)";
    const source = getPlainText(getPropByName(row, sourceField, "Source")) || "(unknown)";
    bounceDomains[domain] = (bounceDomains[domain] || 0) + 1;
    bounceSources[source] = (bounceSources[source] || 0) + 1;
  };

  for (const row of b2bRows) collect(row, "Email", "Source");
  for (const row of distRows) collect(row, "Email", "Source");

  const blockedDomains = new Set(
    Object.entries(bounceDomains)
      .filter(([domain, count]) => domain !== "(unknown)" && count >= 2)
      .map(([domain]) => domain)
  );

  let protectedRows = 0;
  for (const row of b2bRows) {
    const status = getPlainText(getPropByName(row, "Status", "Outreach Status"));
    if (status !== "New - Uncontacted") continue;
    const email = getPlainText(getPropByName(row, "Email", "Email Address"));
    const domain = emailDomain(email);
    if (!domain || !blockedDomains.has(domain)) continue;
    const notes = `${getPlainText(getPropByName(row, "Notes"))}\nBounce intelligence ${todayET()} ET: removed email due to repeated domain bounces (${domain}).`.trim();
    await updatePage(row.id, buildProperties(IDS.b2bProspects, { Email: "", Notes: notes }));
    protectedRows += 1;
  }
  for (const row of distRows) {
    const status = getPlainText(getPropByName(row, "Status", "Outreach Status"));
    if (status !== "New - Uncontacted") continue;
    const email = getPlainText(getPropByName(row, "Email"));
    const domain = emailDomain(email);
    if (!domain || !blockedDomains.has(domain)) continue;
    const notes = `${getPlainText(getPropByName(row, "Notes"))}\nBounce intelligence ${todayET()} ET: removed email due to repeated domain bounces (${domain}).`.trim();
    await updatePage(row.id, buildProperties(IDS.distributorProspects, { Email: "", Notes: notes }));
    protectedRows += 1;
  }

  const title = `${todayLongET()} — Bounce Intelligence`;
  const blocks = [
    blockHeading("Top Bounce Domains"),
    blockParagraph(topEntries(bounceDomains, 10).map(([d, c]) => `${d} (${c})`).join(", ") || "No bounce history yet."),
    blockHeading("Top Bounce Sources"),
    blockParagraph(topEntries(bounceSources, 10).map(([s, c]) => `${s} (${c})`).join(", ") || "No bounce source patterns yet."),
    blockHeading("Protection Actions"),
    blockParagraph(`Domains blocked from new sends today: ${[...blockedDomains].join(", ") || "none"}`),
    blockParagraph(`Queued rows protected (email removed): ${protectedRows}`),
  ];

  await createPageInDb(IDS.dailyReports, buildProperties(IDS.dailyReports, { Name: title }), blocks);
  await logRun({
    agentName: "Agent 9 — Bounce Intelligence",
    recordsProcessed: Object.values(bounceDomains).reduce((a, b) => a + b, 0),
    emailsSent: 0,
    errors: "",
    status: "Success",
    notes: `Published ${title}; protected ${protectedRows} queued rows.`,
  });

  return {
    title,
    bounceDomains: topEntries(bounceDomains, 10),
    blockedDomains: [...blockedDomains],
    protectedRows,
  };
}

/**
 * queueFollowUpDraft — pushes a pending follow-up draft into the reply attention queue
 * for Ben to approve or deny via the Command Center dashboard before anything is sent.
 */
function queueFollowUpDraft({ senderEmail, senderName, company, draftSubject, draftBody, prospectType, pageId }) {
  const list = loadReplyAttentionQueue();
  // Dedup: don't queue the same follow-up twice
  const dup = list.find(
    (x) => x.type === "followup" && x.senderEmail === senderEmail && x.draftSubject === draftSubject && x.status === "pending"
  );
  if (dup) return dup.queueId;
  const queueId = `followup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  list.push({
    queueId,
    type: "followup",
    status: "pending",
    authorizationRequired: true,
    senderEmail,           // the prospect's email (recipient when Ben approves)
    senderName,
    company,
    draftSubject,
    draftBody,
    subject: draftSubject, // alias so dashboard column renders correctly
    prospectType,
    pageId,
    queuedAt: new Date().toISOString(),
  });
  saveReplyAttentionQueue(list);
  return queueId;
}

async function runFollowUpAgent(dryRun = false) {
  const b2bRows = await queryDatabaseAll(IDS.b2bProspects);
  const distRows = await queryDatabaseAll(IDS.distributorProspects);
  const reconcileBefore = dryRun
    ? { pendingBefore: 0, resolvedNow: 0, failedNow: 0, stillPending: 0 }
    : await reconcilePendingSendCommits(120);

  const due = (row, isB2B) => {
    const status = getPlainText(getPropByName(row, "Status", "Outreach Status"));
    if (status !== "Outreach Sent") return false;
    const email = normalizeEmail(getPlainText(getPropByName(row, isB2B ? "Email" : "Email")));
    if (BLOCKED_OUTREACH_EMAILS.has(email)) return false;
    const firstDate = getPlainText(getPropByName(row, "Date First Contacted"));
    const replyReceived = getPlainText(getPropByName(row, "Reply Received")) === "true";
    if (replyReceived || !firstDate) return false;
    const age = daysSince(firstDate);
    return age === 4 || age === 5;
  };

  // Agent 5 does NOT send follow-ups directly. It drafts them and queues them
  // in the reply attention queue for Ben to approve or deny via the Command Center dashboard.
  // Approved drafts are sent by agent10 (self-heal) within 30 minutes.
  let queuedB2B = 0;
  let queuedDist = 0;
  let skippedBlocked = 0;
  const errors = [];

  for (const row of b2bRows.filter((r) => due(r, true))) {
    const email = normalizeEmail(getPlainText(getPropByName(row, "Email", "Email Address")));
    if (!email) continue;
    if (BLOCKED_OUTREACH_EMAILS.has(email)) { skippedBlocked += 1; continue; }
    const verification = await verifyBusinessEmail(email);
    if (!verification.ok) {
      errors.push(`${email}: followup_blocked_unverified_${verification.reason}`);
      continue;
    }
    const contactName = getPlainText(getPropByName(row, "Contact Name"));
    const firstName = getFirstName(contactName);
    const company = getPlainText(getPropByName(row, "Business Name", "Company Name"));
    const draftSubject = TEMPLATE_LIBRARY.b2bFollowUp.subject;
    const draftBody = renderTemplate(TEMPLATE_LIBRARY.b2bFollowUp.body, { "First Name": firstName });

    if (dryRun) {
      queuedB2B += 1;
      continue;
    }

    try {
      queueFollowUpDraft({
        senderEmail: email,
        senderName: contactName || firstName,
        company,
        draftSubject,
        draftBody,
        prospectType: "b2b",
        pageId: row.id,
      });
      queuedB2B += 1;
    } catch (err) {
      errors.push(`${email}: followup_queue_failed_${String(err?.message || err).slice(0, 80)}`);
    }
  }

  for (const row of distRows.filter((r) => due(r, false))) {
    const email = normalizeEmail(getPlainText(getPropByName(row, "Email")));
    if (!email) continue;
    if (BLOCKED_OUTREACH_EMAILS.has(email)) { skippedBlocked += 1; continue; }
    const verification = await verifyBusinessEmail(email);
    if (!verification.ok) {
      errors.push(`${email}: followup_blocked_unverified_${verification.reason}`);
      continue;
    }
    const contactName = getPlainText(getPropByName(row, "Contact Name", "Primary Contact Name"));
    const firstName = getFirstName(contactName);
    const company = getPlainText(getPropByName(row, "Company Name"));
    const draftSubject = TEMPLATE_LIBRARY.distributorFollowUp.subject;
    const draftBody = renderTemplate(TEMPLATE_LIBRARY.distributorFollowUp.body, { "First Name": firstName });

    if (dryRun) {
      queuedDist += 1;
      continue;
    }

    try {
      queueFollowUpDraft({
        senderEmail: email,
        senderName: contactName || firstName,
        company,
        draftSubject,
        draftBody,
        prospectType: "distributor",
        pageId: row.id,
      });
      queuedDist += 1;
    } catch (err) {
      errors.push(`${email}: followup_queue_failed_${String(err?.message || err).slice(0, 80)}`);
    }
  }

  const status = errors.length ? (queuedB2B + queuedDist > 0 ? "Partial" : "Failed") : "Success";
  await logRun({
    agentName: "Agent 5 — Follow-Up Agent",
    recordsProcessed: queuedB2B + queuedDist,
    emailsSent: 0,
    errors: errors.join(" | "),
    status,
    notes: `B2B follow-up drafts queued: ${queuedB2B}; distributor follow-up drafts queued: ${queuedDist}; skipped_blocked: ${skippedBlocked}; reconciled_now ${reconcileBefore.resolvedNow}; reconcile_pending ${reconcileBefore.stillPending}${dryRun ? " (dry run)" : ""}. NOTE: All follow-ups require Ben approval via Command Center dashboard before sending.`,
  });

  return { queuedB2B, queuedDist, skippedBlocked, reconcileBefore, errors, status };
}

function loadProcessedInboxIds(cacheFile = INBOX_CACHE_FILE) {
  try {
    if (!fs.existsSync(cacheFile)) return new Set();
    const arr = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveProcessedInboxIds(set, cacheFile = INBOX_CACHE_FILE) {
  const arr = Array.from(set).slice(-3000);
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(arr, null, 2));
}

function parseEnvelopeTable(raw) {
  const lines = String(raw || "")
    .split("\n")
    .filter((l) => l.startsWith("|") && !l.includes("---") && !l.includes("ID"));
  return lines
    .map((line) => {
      const cols = line.split("|").map((c) => c.trim());
      if (cols[0] === "") cols.shift();
      if (cols[cols.length - 1] === "") cols.pop();
      if (cols.length < 5) return null;
      return {
        id: cols[0],
        flags: cols[1],
        subject: cols[2],
        from: cols[3],
        date: cols[4],
      };
    })
    .filter(Boolean);
}

function classifyReply(envelope, body) {
  const subject = `${envelope.subject || ""}`.toLowerCase();
  const from = `${envelope.from || ""}`.toLowerCase();
  const text = `${body || ""}`.toLowerCase();

  if (/delivery status|undeliverable|mail delivery|bounce|postmaster|failed to deliver/.test(subject + " " + from + " " + text)) {
    return "BOUNCE";
  }
  if (from.includes("faire") || text.includes("faire.com")) {
    if (subject.includes("order")) return "FAIRE_ORDER";
  }
  if (/not interested|no thanks|remove me|stop emailing|pass/.test(text)) {
    return "NOT_INTERESTED";
  }
  if (/interested|let'?s talk|send sample|send sell sheet|would love|call this week|pricing/.test(text)) {
    return "INTERESTED";
  }
  return "OTHER";
}

function extractSenderEmail(text) {
  const m = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? normalizeEmail(m[0]) : "";
}

function extractBouncedRecipientEmail(text) {
  const source = String(text || "");
  const patterns = [
    /Final-Recipient:\s*rfc822;\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i,
    /Original-Recipient:\s*rfc822;\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i,
    /Diagnostic-Code:[\s\S]{0,300}?<([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>/i,
    /\bfor\s+<([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>/i,
    /\bto\s+<([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match?.[1]) continue;
    const email = normalizeEmail(match[1]);
    if (!email) continue;
    if (/(mailer-daemon|postmaster|no-?reply|dmarc|abuse)/i.test(email)) continue;
    return email;
  }

  const all = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  for (const raw of all) {
    const email = normalizeEmail(raw);
    if (!email) continue;
    if (/(mailer-daemon|postmaster|no-?reply|dmarc|abuse|google\.com$|amazonses\.com$)/i.test(email)) continue;
    return email;
  }
  return "";
}

function buildReplyDraft(category, firstName, accountName) {
  const safeFirst = firstName || "there";
  const safeAccount = accountName || "your team";
  if (category === "INTERESTED") {
    return {
      subject: "Re: Thanks for your note — quick next step",
      body: [
        `Hi ${safeFirst},`,
        "",
        `Thanks for getting back to us and for the interest in USA Gummies.`,
        `Happy to send the sell sheet and sample options for ${safeAccount}.`,
        "",
        "If helpful, we can also do a quick 15-minute call this week to align on launch plan and opening order volume.",
        "",
        "Best,",
        "Benjamin",
      ].join("\n"),
    };
  }
  if (category === "NOT_INTERESTED") {
    return {
      subject: "Re: Thanks for the quick response",
      body: [
        `Hi ${safeFirst},`,
        "",
        "Appreciate the quick response.",
        "If timing changes later this year, I’d be glad to reconnect.",
        "",
        "Best,",
        "Benjamin",
      ].join("\n"),
    };
  }
  if (category === "FAIRE_ORDER") {
    return {
      subject: "Re: Thank you for your order",
      body: [
        `Hi ${safeFirst},`,
        "",
        "Thanks for the order. We appreciate the partnership.",
        "If you want merchandising support or reorder timing guidance, we can send that over.",
        "",
        "Best,",
        "Benjamin",
      ].join("\n"),
    };
  }
  return {
    subject: "Re: Quick follow-up",
    body: [
      `Hi ${safeFirst},`,
      "",
      "Thanks for your note. I wanted to follow up personally and make sure we address your question.",
      "What’s the best next step on your side?",
      "",
      "Best,",
      "Benjamin",
    ].join("\n"),
  };
}

async function findProspectByEmail(email) {
  const b2b = await queryDatabaseAll(IDS.b2bProspects, {
    or: [{ property: "Email", email: { equals: email } }, { property: "Email Address", email: { equals: email } }],
  });
  if (b2b.length > 0) return { type: "b2b", row: b2b[0] };

  const dist = await queryDatabaseAll(IDS.distributorProspects, {
    property: "Email",
    email: { equals: email },
  });
  if (dist.length > 0) return { type: "dist", row: dist[0] };

  return null;
}

function isSystemMailbox(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const [local = "", domain = ""] = normalized.split("@");
  if (/^(mailer-daemon|postmaster|dmarc|abuse|bounce|no-?reply)/i.test(local)) return true;
  if (/(google\.com|amazonses\.com|messagingengine\.com|proofpoint\.com)$/i.test(domain)) return true;
  return false;
}

async function runInboxMonitor(options = {}) {
  const backfill = Boolean(options.backfill);
  const queueAttentionEnabled = backfill ? false : options.queueAttention !== false;
  const envelopeCount = clampNumber(
    Number(options.count || (backfill ? 250 : 40)),
    10,
    500
  );
  const maxProcessed = clampNumber(
    Number(options.maxProcessed || (backfill ? 120 : 20)),
    1,
    300
  );
  const cacheFile = backfill ? INBOX_BACKFILL_CACHE_FILE : INBOX_CACHE_FILE;
  const processedIds = loadProcessedInboxIds(cacheFile);
  const raw = execSync(`bash ${CHECK_EMAIL_SCRIPT} --folder INBOX --count ${envelopeCount}`, {
    encoding: "utf8",
    timeout: 90_000,
  });
  const envelopes = parseEnvelopeTable(raw);

  let processedProspectReplies = 0;
  let scanned = 0;
  let unmatched = 0;
  let unmatchedBounces = 0;
  let systemFiltered = 0;
  let interested = 0;
  let notInterested = 0;
  let bounced = 0;
  let fairOrders = 0;
  let other = 0;
  let attentionQueued = 0;
  const errors = [];

  for (const env of envelopes) {
    if (processedProspectReplies >= maxProcessed) break;
    if (processedIds.has(env.id)) continue;
    scanned += 1;

    let body = "";
    try {
      body = execSync(`bash ${CHECK_EMAIL_SCRIPT} --read ${env.id}`, { encoding: "utf8", timeout: 45_000 });
    } catch (err) {
      errors.push(`read ${env.id}: ${(err.message || "error").slice(0, 120)}`);
      processedIds.add(env.id);
      continue;
    }

    const category = classifyReply(env, body);
    const senderEmail = extractSenderEmail(body) || extractSenderEmail(env.from);
    const bouncedRecipientEmail = category === "BOUNCE" ? extractBouncedRecipientEmail(body) : "";
    const lookupEmail = bouncedRecipientEmail || senderEmail;
    const summary = `${env.subject} | ${category}`;

    if (senderEmail && isSystemMailbox(senderEmail) && category !== "BOUNCE") {
      systemFiltered += 1;
      processedIds.add(env.id);
      continue;
    }

    if (lookupEmail) {
      const match = await findProspectByEmail(lookupEmail);
      if (match?.type === "b2b") {
        const row = match.row;
        const accountName = getPlainText(getPropByName(row, "Business Name"));
        const firstName = getFirstName(getPlainText(getPropByName(row, "Contact Name")));
        const draft = buildReplyDraft(category, firstName, accountName);
        if (category !== "BOUNCE" && queueAttentionEnabled) {
          queueReplyAttention({
            queuedAtET: nowETTimestamp(),
            receivedAtET: nowETTimestamp(),
            messageId: env.id,
            senderEmail: lookupEmail,
            subject: env.subject || "(no subject)",
            category,
            prospectType: "B2B",
            prospectName: accountName,
            recommendedAction: category === "INTERESTED" ? "Reply personally ASAP" : "Review and decide response",
            draftSubject: draft.subject,
            draftBody: draft.body,
            source: "agent6-inbox-monitor",
          });
          attentionQueued += 1;
        }
        const updates = {
          "Reply Received": true,
          "Reply Summary": summary,
          Notes: `${getPlainText(getPropByName(row, "Notes"))}\nInbox monitor ${todayET()}: ${summary}`.trim(),
        };
        if (category === "INTERESTED") {
          updates.Status = "Replied - Interested";
          updates.Notes += "\nACTION REQUIRED - Ben to follow up personally.";
          interested += 1;
        } else if (category === "NOT_INTERESTED") {
          updates.Status = "Replied - Not Interested";
          notInterested += 1;
        } else if (category === "BOUNCE") {
          updates.Status = "Bounced";
          bounced += 1;
        } else if (category === "FAIRE_ORDER") {
          updates.Status = "Order Placed";
          updates.Notes += `\nFair.com order signal captured from inbox.`;
          fairOrders += 1;
        } else {
          other += 1;
        }
        await updatePage(row.id, buildProperties(IDS.b2bProspects, updates));
        processedProspectReplies += 1;
      } else if (match?.type === "dist") {
        const row = match.row;
        const accountName = getPlainText(getPropByName(row, "Company Name"));
        const firstName = getFirstName(getPlainText(getPropByName(row, "Contact Name", "Primary Contact Name")));
        const draft = buildReplyDraft(category, firstName, accountName);
        if (category !== "BOUNCE" && queueAttentionEnabled) {
          queueReplyAttention({
            queuedAtET: nowETTimestamp(),
            receivedAtET: nowETTimestamp(),
            messageId: env.id,
            senderEmail: lookupEmail,
            subject: env.subject || "(no subject)",
            category,
            prospectType: "Distributor",
            prospectName: accountName,
            recommendedAction: category === "INTERESTED" ? "Reply personally ASAP" : "Review and decide response",
            draftSubject: draft.subject,
            draftBody: draft.body,
            source: "agent6-inbox-monitor",
          });
          attentionQueued += 1;
        }
        const updates = {
          "Reply Received": true,
          "Reply Summary": summary,
          Notes: `${getPlainText(getPropByName(row, "Notes"))}\nInbox monitor ${todayET()}: ${summary}`.trim(),
        };
        if (category === "INTERESTED") {
          updates.Status = "Replied - Interested";
          updates.Notes += "\nACTION REQUIRED - Ben to follow up personally.";
          interested += 1;
        } else if (category === "NOT_INTERESTED") {
          updates.Status = "Replied - Not Interested";
          notInterested += 1;
        } else if (category === "BOUNCE") {
          updates.Status = "Bounced";
          bounced += 1;
        } else {
          other += 1;
        }
        await updatePage(row.id, buildProperties(IDS.distributorProspects, updates));
        processedProspectReplies += 1;
      } else {
        unmatched += 1;
        if (category === "BOUNCE") unmatchedBounces += 1;
      }
    } else {
      unmatched += 1;
      if (category === "BOUNCE") unmatchedBounces += 1;
    }

    processedIds.add(env.id);
  }

  saveProcessedInboxIds(processedIds, cacheFile);

  const status = errors.length ? "Partial" : "Success";
  await logRun({
    agentName: "Agent 6 — Inbox Monitor + Reply Logger",
    recordsProcessed: processedProspectReplies,
    emailsSent: 0,
    errors: errors.join(" | "),
    status,
    notes: `Mode: ${backfill ? "backfill" : "standard"}; scanned: ${scanned}; matched_replies: ${processedProspectReplies}; unmatched: ${unmatched}; unmatched_bounces: ${unmatchedBounces}; system_filtered: ${systemFiltered}; interested: ${interested}; not interested: ${notInterested}; bounced: ${bounced}; fair orders: ${fairOrders}; other: ${other}; reply_attention_queued: ${attentionQueued}; replies are drafted only and never auto-sent.`,
  });

  return {
    mode: backfill ? "backfill" : "standard",
    envelopeCount,
    maxProcessed,
    processed: processedProspectReplies,
    processedProspectReplies,
    scanned,
    unmatched,
    unmatchedBounces,
    systemFiltered,
    interested,
    notInterested,
    bounced,
    fairOrders,
    other,
    attentionQueued,
    autoReplySent: 0,
    errors,
    status,
  };
}

function countByStatus(rows) {
  const out = new Map();
  for (const row of rows) {
    const status = getPlainText(getPropByName(row, "Status", "Outreach Status")) || "(blank)";
    out.set(status, (out.get(status) || 0) + 1);
  }
  return Object.fromEntries(out.entries());
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function buildTractionSnapshot(b2bStatus, distStatus) {
  const b2bOutreach = (b2bStatus["Outreach Sent"] || 0) + (b2bStatus["Follow-Up Sent"] || 0) + (b2bStatus["Replied - Interested"] || 0) + (b2bStatus["Replied - Not Interested"] || 0) + (b2bStatus["Order Placed"] || 0);
  const distOutreach = (distStatus["Outreach Sent"] || 0) + (distStatus["Follow-Up Sent"] || 0) + (distStatus["Replied - Interested"] || 0) + (distStatus["Replied - Not Interested"] || 0) + (distStatus["Contract Discussion"] || 0) + (distStatus["Contract Signed"] || 0);
  const b2bInterested = b2bStatus["Replied - Interested"] || 0;
  const distInterested = distStatus["Replied - Interested"] || 0;
  const b2bBounced = b2bStatus.Bounced || 0;
  const distBounced = distStatus.Bounced || 0;

  return {
    b2b: {
      outreachBase: b2bOutreach,
      interested: b2bInterested,
      bounced: b2bBounced,
      orderPlaced: b2bStatus["Order Placed"] || 0,
      interestRatePct: pct(b2bInterested, b2bOutreach),
      bounceRatePct: pct(b2bBounced, b2bOutreach),
      orderRatePct: pct(b2bStatus["Order Placed"] || 0, b2bOutreach),
    },
    distributor: {
      outreachBase: distOutreach,
      interested: distInterested,
      bounced: distBounced,
      contractsSigned: distStatus["Contract Signed"] || 0,
      interestRatePct: pct(distInterested, distOutreach),
      bounceRatePct: pct(distBounced, distOutreach),
      contractRatePct: pct(distStatus["Contract Signed"] || 0, distOutreach),
    },
  };
}

async function sumEmailsSentTodayFromRunLog() {
  const rows = await queryDatabaseAll(IDS.runLog);
  let totalB2B = 0;
  let totalDist = 0;
  let followups = 0;
  let errors = [];

  for (const row of rows) {
    const runDate = getPlainText(getPropByName(row, "Run Date", "Timestamp"));
    if (!runDate.startsWith(todayET())) continue;

    const agent = getPlainText(getPropByName(row, "Agent Name", "Name", "Agent"));
    const sent = Number(getPlainText(getPropByName(row, "Emails Sent")) || 0);

    if (agent.includes("Agent 3")) totalB2B += sent;
    else if (agent.includes("Agent 4")) totalDist += sent;
    else if (agent.includes("Agent 5")) followups += sent;

    const err = getPlainText(getPropByName(row, "Errors", "Details"));
    if (err) errors.push(`${agent}: ${err}`);
  }

  return { totalB2B, totalDist, followups, errors };
}

async function runDailyPerformanceReport() {
  const [b2bRows, distRows, runSummary] = await Promise.all([
    queryDatabaseAll(IDS.b2bProspects),
    queryDatabaseAll(IDS.distributorProspects),
    sumEmailsSentTodayFromRunLog(),
  ]);

  const b2bStatus = countByStatus(b2bRows);
  const distStatus = countByStatus(distRows);
  const traction = buildTractionSnapshot(b2bStatus, distStatus);

  const replies = {
    interested:
      (b2bStatus["Replied - Interested"] || 0) +
      (distStatus["Replied - Interested"] || 0),
    notInterested:
      (b2bStatus["Replied - Not Interested"] || 0) +
      (distStatus["Replied - Not Interested"] || 0),
    bounced: (b2bStatus.Bounced || 0) + (distStatus.Bounced || 0),
  };

  const followFlags = b2bRows.filter((r) => getPlainText(getPropByName(r, "Notes")).includes("ACTION REQUIRED")).length +
    distRows.filter((r) => getPlainText(getPropByName(r, "Notes")).includes("ACTION REQUIRED")).length;

  const fairOrders = b2bStatus["Order Placed"] || 0;

  const title = `${todayLongET()} — Daily Report`;
  const children = [
    blockHeading("Email Output"),
    blockParagraph(`B2B emails sent today: ${runSummary.totalB2B}`),
    blockParagraph(`Distributor emails sent today: ${runSummary.totalDist}`),
    blockParagraph(`Follow-up emails sent today: ${runSummary.followups}`),
    blockHeading("Prospecting Output"),
    blockParagraph(`B2B prospects in pipeline: ${b2bRows.length}`),
    blockParagraph(`Distributor prospects in pipeline: ${distRows.length}`),
    blockHeading("Reply Outcomes"),
    blockParagraph(`Replies received - interested: ${replies.interested}`),
    blockParagraph(`Replies received - not interested: ${replies.notInterested}`),
    blockParagraph(`Replies received - bounced: ${replies.bounced}`),
    blockParagraph(`Fair.com orders logged: ${fairOrders}`),
    blockParagraph(`Records flagged for personal follow-up: ${followFlags}`),
    blockHeading("Traction KPIs"),
    blockParagraph(`B2B interest rate: ${traction.b2b.interestRatePct}% (${traction.b2b.interested}/${traction.b2b.outreachBase})`),
    blockParagraph(`B2B bounce rate: ${traction.b2b.bounceRatePct}% (${traction.b2b.bounced}/${traction.b2b.outreachBase})`),
    blockParagraph(`B2B order rate: ${traction.b2b.orderRatePct}% (${traction.b2b.orderPlaced}/${traction.b2b.outreachBase})`),
    blockParagraph(`Distributor interest rate: ${traction.distributor.interestRatePct}% (${traction.distributor.interested}/${traction.distributor.outreachBase})`),
    blockParagraph(`Distributor bounce rate: ${traction.distributor.bounceRatePct}% (${traction.distributor.bounced}/${traction.distributor.outreachBase})`),
    blockParagraph(`Distributor contract rate: ${traction.distributor.contractRatePct}% (${traction.distributor.contractsSigned}/${traction.distributor.outreachBase})`),
    blockHeading("Pipeline Summary - B2B"),
    ...Object.entries(b2bStatus).map(([k, v]) => blockParagraph(`${k}: ${v}`)),
    blockHeading("Pipeline Summary - Distributor"),
    ...Object.entries(distStatus).map(([k, v]) => blockParagraph(`${k}: ${v}`)),
    blockHeading("Agent Errors / Failures"),
    ...(runSummary.errors.length ? runSummary.errors.slice(0, 20).map((x) => blockParagraph(x)) : [blockParagraph("No logged errors today.")]),
  ];

  await createPageInDb(IDS.dailyReports, buildProperties(IDS.dailyReports, { Name: title }), children);

  await logRun({
    agentName: "Agent 7 — Daily Performance Report",
    recordsProcessed: b2bRows.length + distRows.length,
    emailsSent: 0,
    errors: "",
    status: "Success",
    notes: `Created ${title}.`,
  });

  return { title, b2bCount: b2bRows.length, distributorCount: distRows.length };
}

function clampPct(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function runRevenueAttributionForecastAgent() {
  const [b2bRows, distRows] = await Promise.all([queryDatabaseAll(IDS.b2bProspects), queryDatabaseAll(IDS.distributorProspects)]);
  const b2bStatus = countByStatus(b2bRows);
  const distStatus = countByStatus(distRows);
  const traction = buildTractionSnapshot(b2bStatus, distStatus);
  const ledger = loadRunLedger();
  const today = todayET();
  const todayRuns = ledger.filter((x) => x.runDateET === today && x.status === "success");

  const b2bSentToday = todayRuns
    .filter((x) => x.agent === "agent3")
    .reduce((sum, x) => sum + Number(x.result?.sent || 0), 0);
  const distSentToday = todayRuns
    .filter((x) => x.agent === "agent4")
    .reduce((sum, x) => sum + Number(x.result?.sent || 0), 0);
  const followUpsToday = todayRuns
    .filter((x) => x.agent === "agent5")
    .reduce((sum, x) => sum + Number((x.result?.sentB2B || 0) + (x.result?.sentDist || 0)), 0);
  const repliesToday = todayRuns
    .filter((x) => x.agent === "agent6")
    .reduce((sum, x) => sum + Number(x.result?.processed || 0), 0);
  const leadsCultivatedToday = todayRuns
    .filter((x) => x.agent === "agent1" || x.agent === "agent2")
    .reduce((sum, x) => sum + Number(x.result?.added || 0), 0);

  const b2bReplyRate = clampPct((traction.b2b.interestRatePct || 0) / 100, 0.01, 0.25);
  const b2bCloseRateFromInterested = clampPct(traction.b2b.orderPlaced > 0 && traction.b2b.interested > 0 ? traction.b2b.orderPlaced / traction.b2b.interested : 0.18, 0.05, 0.5);
  const distReplyRate = clampPct((traction.distributor.interestRatePct || 0) / 100, 0.01, 0.2);
  const distCloseRateFromInterested = clampPct(
    traction.distributor.contractsSigned > 0 && traction.distributor.interested > 0
      ? traction.distributor.contractsSigned / traction.distributor.interested
      : 0.12,
    0.03,
    0.4
  );

  const projectedB2BSends30 = SEND_POLICY.b2bFloorPerDay * 30;
  const projectedDistSends30 = SEND_POLICY.distributorFloorPerDay * 30;
  const projectedB2BInterested30 = Math.round(projectedB2BSends30 * b2bReplyRate);
  const projectedDistInterested30 = Math.round(projectedDistSends30 * distReplyRate);
  const projectedB2BOrders30 = Math.round(projectedB2BInterested30 * b2bCloseRateFromInterested);
  const projectedDistContracts30 = Math.round(projectedDistInterested30 * distCloseRateFromInterested);

  const title = `${todayLongET()} — Revenue Attribution Forecast`;
  const blocks = [
    blockHeading("Current Funnel Attribution"),
    blockParagraph(`B2B outreach base: ${traction.b2b.outreachBase}`),
    blockParagraph(`B2B interested replies: ${traction.b2b.interested}`),
    blockParagraph(`B2B orders placed: ${traction.b2b.orderPlaced}`),
    blockParagraph(`Distributor outreach base: ${traction.distributor.outreachBase}`),
    blockParagraph(`Distributor interested replies: ${traction.distributor.interested}`),
    blockParagraph(`Distributor contracts signed: ${traction.distributor.contractsSigned}`),
    blockHeading("Today Performance"),
    blockParagraph(`Leads cultivated today (B2B+Distributor): ${leadsCultivatedToday}`),
    blockParagraph(`Emails sent today: B2B ${b2bSentToday}, Distributor ${distSentToday}, Follow-ups ${followUpsToday}`),
    blockParagraph(`Replies processed today: ${repliesToday}`),
    blockHeading("30-Day Forecast (Floor-Based)"),
    blockParagraph(`B2B sends forecast (floor): ${projectedB2BSends30}`),
    blockParagraph(`B2B interested forecast: ${projectedB2BInterested30}`),
    blockParagraph(`B2B orders forecast: ${projectedB2BOrders30}`),
    blockParagraph(`Distributor sends forecast (floor): ${projectedDistSends30}`),
    blockParagraph(`Distributor interested forecast: ${projectedDistInterested30}`),
    blockParagraph(`Distributor contracts forecast: ${projectedDistContracts30}`),
    blockHeading("Assumptions"),
    blockParagraph(`B2B reply rate assumption: ${(b2bReplyRate * 100).toFixed(1)}%; close-from-interested assumption: ${(b2bCloseRateFromInterested * 100).toFixed(1)}%`),
    blockParagraph(`Distributor reply rate assumption: ${(distReplyRate * 100).toFixed(1)}%; close-from-interested assumption: ${(distCloseRateFromInterested * 100).toFixed(1)}%`),
    blockParagraph("Forecast is floor-based and should improve as reply and close rates increase."),
  ];

  await createPageInDb(IDS.dailyReports, buildProperties(IDS.dailyReports, { Name: title }), blocks);
  await logRun({
    agentName: "Agent 11 — Revenue Attribution Forecast",
    recordsProcessed: b2bRows.length + distRows.length,
    emailsSent: 0,
    errors: "",
    status: "Success",
    notes: `Published ${title}; b2b_orders_30d=${projectedB2BOrders30}; distributor_contracts_30d=${projectedDistContracts30}.`,
  });

  return {
    title,
    projectedB2BOrders30,
    projectedDistContracts30,
    b2bReplyRatePct: Number((b2bReplyRate * 100).toFixed(1)),
    distReplyRatePct: Number((distReplyRate * 100).toFixed(1)),
  };
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function qualityGrade(score) {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  return "D";
}

function upsertContactQaLine(notes, qaLine) {
  const lines = String(notes || "")
    .split("\n")
    .map((x) => x.trimEnd())
    .filter(Boolean)
    .filter((line) => !line.startsWith("Contact QA "));
  lines.push(qaLine);
  return lines.join("\n").trim();
}

function buildContactQuality(verification, notesText, contactName) {
  let score = verification.ok ? 68 : 20;
  const reasons = [];
  if (verification.ok) reasons.push("dns_reachable");
  if (String(notesText || "").includes("Email source:")) {
    score += 10;
    reasons.push("source_noted");
  }
  if (String(notesText || "").includes("Website:")) {
    score += 6;
    reasons.push("website_noted");
  }
  if (String(contactName || "").trim()) {
    score += 6;
    reasons.push("named_contact");
  }
  if (verification.flags?.includes("freemail_domain")) {
    score -= 10;
    reasons.push("freemail_domain");
  }
  if (verification.flags?.includes("role_or_utility_mailbox")) {
    score -= 8;
    reasons.push("role_mailbox");
  }
  if (!verification.ok && verification.reason) {
    reasons.push(verification.reason);
  }
  score = clampNumber(score, 0, 99);
  const grade = qualityGrade(score);
  const sendEligible = verification.ok && grade !== "D";
  return { score, grade, sendEligible, reasons };
}

async function runBalancedContactVerifierAgent(limit = 250) {
  const deliverabilityGuard = loadDeliverabilityGuard();
  const [b2bRows, distRows] = await Promise.all([queryDatabaseAll(IDS.b2bProspects), queryDatabaseAll(IDS.distributorProspects)]);
  const b2bCandidates = b2bRows.filter((row) => {
    const status = getPlainText(getPropByName(row, "Status", "Outreach Status"));
    const email = normalizeEmail(getPlainText(getPropByName(row, "Email", "Email Address")));
    return status === "New - Uncontacted" && Boolean(email);
  });
  const distCandidates = distRows.filter((row) => {
    const status = getPlainText(getPropByName(row, "Status", "Outreach Status"));
    const email = normalizeEmail(getPlainText(getPropByName(row, "Email")));
    return status === "New - Uncontacted" && Boolean(email);
  });

  const queue = [
    ...b2bCandidates.map((row) => ({ kind: "b2b", row })),
    ...distCandidates.map((row) => ({ kind: "dist", row })),
  ].slice(0, Math.max(0, Number(limit || 0)));

  let reviewed = 0;
  let eligible = 0;
  let blocked = 0;
  let deliverabilityBlocked = 0;
  let freemailFlagged = 0;
  let roleMailboxFlagged = 0;
  const gradeCounts = { A: 0, B: 0, C: 0, D: 0 };
  const errors = [];

  for (const item of queue) {
    const row = item.row;
    const isB2B = item.kind === "b2b";
    const email = normalizeEmail(getPlainText(getPropByName(row, isB2B ? "Email" : "Email", "Email Address")));
    if (!email) continue;

    reviewed += 1;
    const verification = await verifyBusinessEmail(email);
    const notesNow = getPlainText(getPropByName(row, "Notes"));
    const contactName = getPlainText(getPropByName(row, "Contact Name", "Primary Contact Name"));
    const quality = buildContactQuality(verification, notesNow, contactName);
    const domain = stripWww(extractEmailParts(email).domain);
    if (isDomainBlockedByDeliverability(domain, deliverabilityGuard)) {
      quality.sendEligible = false;
      quality.grade = "D";
      quality.reasons.push("deliverability_blocked_domain");
      deliverabilityBlocked += 1;
    }
    gradeCounts[quality.grade] += 1;
    if (verification.flags?.includes("freemail_domain")) freemailFlagged += 1;
    if (verification.flags?.includes("role_or_utility_mailbox")) roleMailboxFlagged += 1;
    if (quality.sendEligible) eligible += 1;
    if (!quality.sendEligible) blocked += 1;

    const qaLine = `Contact QA ${todayET()} ET: grade=${quality.grade}, score=${quality.score}, eligible=${quality.sendEligible ? "yes" : "no"}, checks=${quality.reasons.join(",") || "none"}.`;
    const updates = {
      Notes: upsertContactQaLine(notesNow, qaLine),
    };
    if (isHardVerificationFailure(verification.reason)) {
      updates.Status = "Bounced";
    }

    try {
      const dbId = isB2B ? IDS.b2bProspects : IDS.distributorProspects;
      await updatePage(row.id, buildProperties(dbId, updates));
    } catch (err) {
      errors.push(`${email}: ${(err?.message || err || "update_error").toString().slice(0, 160)}`);
    }
  }

  const status = errors.length ? (reviewed > 0 ? "Partial" : "Failed") : "Success";
  await logRun({
    agentName: "Agent 12 — Balanced Contact Verifier",
    recordsProcessed: reviewed,
    emailsSent: 0,
    errors: errors.join(" | "),
    status,
    notes: `Reviewed ${reviewed}; eligible ${eligible}; blocked ${blocked}; grades A:${gradeCounts.A} B:${gradeCounts.B} C:${gradeCounts.C} D:${gradeCounts.D}; freemail_flagged ${freemailFlagged}; role_mailbox_flagged ${roleMailboxFlagged}.`,
  });

  return {
    reviewed,
    eligible,
    blocked,
    deliverabilityBlocked,
    gradeCounts,
    freemailFlagged,
    roleMailboxFlagged,
    errors,
    status,
  };
}

async function runQuotaFloorEnforcerAgent(dryRun = false) {
  const b2bFloor = SEND_POLICY.b2bFloorPerDay;
  const distFloor = SEND_POLICY.distributorFloorPerDay;
  const b2bSentBefore = sumAgentSendsForDate("agent3", todayET());
  const distSentBefore = sumAgentSendsForDate("agent4", todayET());
  const b2bShortfallBefore = Math.max(0, b2bFloor - b2bSentBefore);
  const distShortfallBefore = Math.max(0, distFloor - distSentBefore);
  const actions = [];

  if (!dryRun && b2bShortfallBefore > 0) {
    const researchTarget = clampNumber(Math.max(20, b2bShortfallBefore * 2), 20, 80);
    const research = await runAgentByName("agent1", { source: "agent13-floor-enforcer", target: researchTarget });
    const send = await runAgentByName("agent3", { source: "agent13-floor-enforcer", limit: b2bShortfallBefore });
    actions.push({
      segment: "b2b",
      shortfallBefore: b2bShortfallBefore,
      researchTarget,
      researchAdded: Number(research?.added || 0),
      sent: Number(send?.sent || 0),
      shortfallAfter: Number(send?.shortfall ?? Math.max(0, b2bFloor - sumAgentSendsForDate("agent3", todayET()))),
    });
  }

  if (!dryRun && distShortfallBefore > 0) {
    const researchTarget = clampNumber(Math.max(8, distShortfallBefore * 2), 8, 30);
    const research = await runAgentByName("agent2", { source: "agent13-floor-enforcer", target: researchTarget });
    const send = await runAgentByName("agent4", { source: "agent13-floor-enforcer", limit: distShortfallBefore });
    actions.push({
      segment: "distributor",
      shortfallBefore: distShortfallBefore,
      researchTarget,
      researchAdded: Number(research?.added || 0),
      sent: Number(send?.sent || 0),
      shortfallAfter: Number(send?.shortfall ?? Math.max(0, distFloor - sumAgentSendsForDate("agent4", todayET()))),
    });
  }

  const b2bSentAfter = sumAgentSendsForDate("agent3", todayET());
  const distSentAfter = sumAgentSendsForDate("agent4", todayET());
  const b2bShortfallAfter = Math.max(0, b2bFloor - b2bSentAfter);
  const distShortfallAfter = Math.max(0, distFloor - distSentAfter);
  const status = b2bShortfallAfter === 0 && distShortfallAfter === 0 ? "Success" : "Partial";

  await logRun({
    agentName: "Agent 13 — Quota Floor Enforcer",
    recordsProcessed: actions.length,
    emailsSent: actions.reduce((sum, item) => sum + Number(item.sent || 0), 0),
    errors: "",
    status,
    notes: dryRun
      ? `Dry run. B2B shortfall before ${b2bShortfallBefore}; Distributor shortfall before ${distShortfallBefore}.`
      : `B2B sent ${b2bSentBefore}->${b2bSentAfter} (shortfall ${b2bShortfallBefore}->${b2bShortfallAfter}); Distributor sent ${distSentBefore}->${distSentAfter} (shortfall ${distShortfallBefore}->${distShortfallAfter}).`,
  });

  return {
    dryRun,
    actions,
    b2b: { floor: b2bFloor, sentBefore: b2bSentBefore, sentAfter: b2bSentAfter, shortfallBefore: b2bShortfallBefore, shortfallAfter: b2bShortfallAfter },
    distributor: { floor: distFloor, sentBefore: distSentBefore, sentAfter: distSentAfter, shortfallBefore: distShortfallBefore, shortfallAfter: distShortfallAfter },
    status,
  };
}

function recentEtDates(days) {
  const out = [];
  for (let i = 0; i < days; i += 1) {
    out.push(addDaysToDate(todayET(), -i));
  }
  return out;
}

function latestLedgerForDay(ledger, agent, runDateET) {
  const matches = ledger
    .filter((x) => x?.agent === agent && x?.runDateET === runDateET && (x?.status === "success" || x?.status === "partial"))
    .sort((a, b) => Date.parse(a?.runAt || "") - Date.parse(b?.runAt || ""));
  return matches.length ? matches[matches.length - 1] : null;
}

function consecutiveZeroAddRuns(ledger, agent, lookbackRuns = 6) {
  const recent = [...ledger]
    .filter((x) => x?.agent === agent && (x?.status === "success" || x?.status === "partial"))
    .sort((a, b) => Date.parse(b?.runAt || "") - Date.parse(a?.runAt || ""))
    .slice(0, Math.max(1, Number(lookbackRuns || 1)));
  let streak = 0;
  for (const row of recent) {
    if (Number(row?.result?.added || 0) > 0) break;
    streak += 1;
  }
  return streak;
}

function pctValue(num, den) {
  if (!den) return 0;
  return Number(((num / den) * 100).toFixed(1));
}

async function runKpiGovernorAgent() {
  const [b2bRows, distRows] = await Promise.all([queryDatabaseAll(IDS.b2bProspects), queryDatabaseAll(IDS.distributorProspects)]);
  const ledger = loadRunLedger();
  const current = loadKpiTuning();
  const next = { ...current };
  const changes = [];
  const days = recentEtDates(KPI_GOVERNOR_POLICY.floorWindowDays);
  const today = todayET();

  const b2bMissDays = days.filter((date) => {
    const e = latestLedgerForDay(ledger, "agent3", date);
    return Number(e?.result?.shortfall ?? SEND_POLICY.b2bFloorPerDay) > 0;
  }).length;
  const distMissDays = days.filter((date) => {
    const e = latestLedgerForDay(ledger, "agent4", date);
    return Number(e?.result?.shortfall ?? SEND_POLICY.distributorFloorPerDay) > 0;
  }).length;
  const todayB2BShortfall = Number(latestLedgerForDay(ledger, "agent3", today)?.result?.shortfall ?? SEND_POLICY.b2bFloorPerDay);
  const todayDistShortfall = Number(latestLedgerForDay(ledger, "agent4", today)?.result?.shortfall ?? SEND_POLICY.distributorFloorPerDay);

  const b2bStatus = countByStatus(b2bRows);
  const distStatus = countByStatus(distRows);
  const b2bOutreachBase = ADAPTIVE_PARAMS.b2bReachedStatuses.reduce((sum, s) => sum + Number(b2bStatus[s] || 0), 0);
  const distOutreachBase = ADAPTIVE_PARAMS.distributorReachedStatuses.reduce((sum, s) => sum + Number(distStatus[s] || 0), 0);
  const b2bBounceRatePct = pctValue(Number(b2bStatus.Bounced || 0), b2bOutreachBase);
  const distBounceRatePct = pctValue(Number(distStatus.Bounced || 0), distOutreachBase);

  if (b2bMissDays >= KPI_GOVERNOR_POLICY.minMissDaysToEscalate) {
    const prev = Number(next.b2bResearchMultiplier || 1);
    const updated = clampNumber(prev + KPI_GOVERNOR_POLICY.b2bMultiplierStep, KPI_GOVERNOR_POLICY.minMultiplier, KPI_GOVERNOR_POLICY.maxMultiplier);
    if (updated !== prev) {
      next.b2bResearchMultiplier = updated;
      changes.push(`B2B multiplier ${prev.toFixed(2)} -> ${updated.toFixed(2)} (miss_days=${b2bMissDays})`);
    }
    const prevCap = Number(next.b2bSearchCallsCap || ADAPTIVE_PARAMS.b2bMaxSearchCallsPerRun);
    const updatedCap = clampNumber(prevCap + KPI_GOVERNOR_POLICY.searchCapStep, KPI_GOVERNOR_POLICY.minSearchCap, KPI_GOVERNOR_POLICY.maxSearchCap);
    if (updatedCap !== prevCap) {
      next.b2bSearchCallsCap = updatedCap;
      changes.push(`B2B search cap ${prevCap} -> ${updatedCap}`);
    }
  }

  if (distMissDays >= KPI_GOVERNOR_POLICY.minMissDaysToEscalate) {
    const prev = Number(next.distributorResearchMultiplier || 1);
    const updated = clampNumber(prev + KPI_GOVERNOR_POLICY.distributorMultiplierStep, KPI_GOVERNOR_POLICY.minMultiplier, KPI_GOVERNOR_POLICY.maxMultiplier);
    if (updated !== prev) {
      next.distributorResearchMultiplier = updated;
      changes.push(`Distributor multiplier ${prev.toFixed(2)} -> ${updated.toFixed(2)} (miss_days=${distMissDays})`);
    }
    const prevCap = Number(next.distributorSearchCallsCap || ADAPTIVE_PARAMS.distributorMaxSearchCallsPerRun);
    const updatedCap = clampNumber(prevCap + KPI_GOVERNOR_POLICY.searchCapStep, KPI_GOVERNOR_POLICY.minSearchCap, KPI_GOVERNOR_POLICY.maxSearchCap);
    if (updatedCap !== prevCap) {
      next.distributorSearchCallsCap = updatedCap;
      changes.push(`Distributor search cap ${prevCap} -> ${updatedCap}`);
    }
  }

  if (b2bMissDays === 0 && todayB2BShortfall === 0 && Number(next.b2bResearchMultiplier || 1) > 1) {
    const prev = Number(next.b2bResearchMultiplier || 1);
    const updated = clampNumber(prev - 0.05, KPI_GOVERNOR_POLICY.minMultiplier, KPI_GOVERNOR_POLICY.maxMultiplier);
    if (updated !== prev) {
      next.b2bResearchMultiplier = updated;
      changes.push(`B2B multiplier normalized ${prev.toFixed(2)} -> ${updated.toFixed(2)}`);
    }
  }
  if (distMissDays === 0 && todayDistShortfall === 0 && Number(next.distributorResearchMultiplier || 1) > 1) {
    const prev = Number(next.distributorResearchMultiplier || 1);
    const updated = clampNumber(prev - 0.05, KPI_GOVERNOR_POLICY.minMultiplier, KPI_GOVERNOR_POLICY.maxMultiplier);
    if (updated !== prev) {
      next.distributorResearchMultiplier = updated;
      changes.push(`Distributor multiplier normalized ${prev.toFixed(2)} -> ${updated.toFixed(2)}`);
    }
  }

  next.changeNotes = [...(Array.isArray(next.changeNotes) ? next.changeNotes : []), ...changes.map((c) => `${todayET()} ET: ${c}`)].slice(-80);
  const saved = saveKpiTuning(next);

  const title = `${todayLongET()} — KPI Governor`;
  const blocks = [
    blockHeading("Floor Compliance Assessment"),
    blockParagraph(`B2B floor shortfall today: ${todayB2BShortfall}; miss-days window (${KPI_GOVERNOR_POLICY.floorWindowDays}d): ${b2bMissDays}`),
    blockParagraph(`Distributor floor shortfall today: ${todayDistShortfall}; miss-days window (${KPI_GOVERNOR_POLICY.floorWindowDays}d): ${distMissDays}`),
    blockHeading("Deliverability Context"),
    blockParagraph(`B2B bounce rate: ${b2bBounceRatePct}% (${Number(b2bStatus.Bounced || 0)}/${b2bOutreachBase})`),
    blockParagraph(`Distributor bounce rate: ${distBounceRatePct}% (${Number(distStatus.Bounced || 0)}/${distOutreachBase})`),
    blockHeading("Applied Tuning"),
    blockParagraph(`B2B multiplier: ${Number(saved.b2bResearchMultiplier || 1).toFixed(2)}; B2B search cap: ${saved.b2bSearchCallsCap}`),
    blockParagraph(`Distributor multiplier: ${Number(saved.distributorResearchMultiplier || 1).toFixed(2)}; Distributor search cap: ${saved.distributorSearchCallsCap}`),
    blockHeading("Change Log"),
    ...(changes.length ? changes.map((line) => blockParagraph(line)) : [blockParagraph("No tuning changes required this run.")]),
  ];

  await createPageInDb(IDS.dailyReports, buildProperties(IDS.dailyReports, { Name: title }), blocks);
  await logRun({
    agentName: "Agent 16 — KPI Governor",
    recordsProcessed: b2bRows.length + distRows.length,
    emailsSent: 0,
    errors: "",
    status: "Success",
    notes: changes.length ? changes.join(" | ") : "No changes required.",
  });

  return {
    title,
    changes,
    b2bMissDays,
    distMissDays,
    todayB2BShortfall,
    todayDistShortfall,
    tuning: {
      b2bResearchMultiplier: saved.b2bResearchMultiplier,
      distributorResearchMultiplier: saved.distributorResearchMultiplier,
      b2bSearchCallsCap: saved.b2bSearchCallsCap,
      distributorSearchCallsCap: saved.distributorSearchCallsCap,
    },
  };
}

async function runDeliverabilitySreAgent() {
  const [b2bRows, distRows] = await Promise.all([queryDatabaseAll(IDS.b2bProspects), queryDatabaseAll(IDS.distributorProspects)]);
  const guard = loadDeliverabilityGuard();
  const today = todayET();
  const expiresOn = addDaysToDate(today, DELIVERABILITY_POLICY.blockTtlDays);
  const domainStats = {};
  const sourceStats = {};

  const upsertStat = (map, key, status, isReachedSet) => {
    if (!key) return;
    if (!map[key]) map[key] = { outreach: 0, bounced: 0 };
    if (isReachedSet.has(status)) map[key].outreach += 1;
    if (status === "Bounced") map[key].bounced += 1;
  };

  const b2bReached = new Set(ADAPTIVE_PARAMS.b2bReachedStatuses);
  for (const row of b2bRows) {
    const status = getPlainText(getPropByName(row, "Status", "Outreach Status"));
    const email = getPlainText(getPropByName(row, "Email", "Email Address"));
    const domain = stripWww(emailDomain(email));
    const source = normalizeText(getPlainText(getPropByName(row, "Source")));
    upsertStat(domainStats, domain, status, b2bReached);
    upsertStat(sourceStats, source, status, b2bReached);
  }

  const distReached = new Set(ADAPTIVE_PARAMS.distributorReachedStatuses);
  for (const row of distRows) {
    const status = getPlainText(getPropByName(row, "Status", "Outreach Status"));
    const email = getPlainText(getPropByName(row, "Email"));
    const domain = stripWww(emailDomain(email));
    const source = normalizeText(getPlainText(getPropByName(row, "Source")));
    upsertStat(domainStats, domain, status, distReached);
    upsertStat(sourceStats, source, status, distReached);
  }

  const blockedDomainsAdded = [];
  const blockedSourcesAdded = [];
  for (const [domain, stat] of Object.entries(domainStats)) {
    const bounceRatePct = pctValue(stat.bounced, stat.outreach);
    if (stat.bounced < DELIVERABILITY_POLICY.domainMinBounces) continue;
    if (bounceRatePct < DELIVERABILITY_POLICY.domainMinBounceRatePct) continue;
    if (!guard.blockedDomains[domain]) blockedDomainsAdded.push(domain);
    guard.blockedDomains[domain] = {
      reason: `bounce_rate_${bounceRatePct}%`,
      bounced: stat.bounced,
      outreach: stat.outreach,
      bounceRatePct,
      addedOn: today,
      expiresOn,
    };
  }

  for (const [source, stat] of Object.entries(sourceStats)) {
    if (!source) continue;
    const bounceRatePct = pctValue(stat.bounced, stat.outreach);
    if (stat.bounced < DELIVERABILITY_POLICY.sourceMinBounces) continue;
    if (bounceRatePct < DELIVERABILITY_POLICY.sourceMinBounceRatePct) continue;
    if (!guard.blockedSources[source]) blockedSourcesAdded.push(source);
    guard.blockedSources[source] = {
      reason: `bounce_rate_${bounceRatePct}%`,
      bounced: stat.bounced,
      outreach: stat.outreach,
      bounceRatePct,
      addedOn: today,
      expiresOn,
    };
  }

  const saved = saveDeliverabilityGuard(guard);
  const topDomainRisks = Object.entries(domainStats)
    .map(([domain, stat]) => ({
      domain,
      bounced: stat.bounced,
      outreach: stat.outreach,
      bounceRatePct: pctValue(stat.bounced, stat.outreach),
    }))
    .filter((x) => x.bounced > 0)
    .sort((a, b) => b.bounceRatePct - a.bounceRatePct || b.bounced - a.bounced)
    .slice(0, 10);

  const title = `${todayLongET()} — Deliverability SRE`;
  const blocks = [
    blockHeading("Guardrail Summary"),
    blockParagraph(`Active blocked domains: ${Object.keys(saved.blockedDomains || {}).length}`),
    blockParagraph(`Active blocked sources: ${Object.keys(saved.blockedSources || {}).length}`),
    blockHeading("New Blocks Added This Run"),
    blockParagraph(`Domains: ${blockedDomainsAdded.join(", ") || "none"}`),
    blockParagraph(`Sources: ${blockedSourcesAdded.join(", ") || "none"}`),
    blockHeading("Top Bounce Risks"),
    ...(topDomainRisks.length
      ? topDomainRisks.map((x) => blockParagraph(`${x.domain}: ${x.bounceRatePct}% (${x.bounced}/${x.outreach})`))
      : [blockParagraph("No bounce domains detected.")]),
  ];

  await createPageInDb(IDS.dailyReports, buildProperties(IDS.dailyReports, { Name: title }), blocks);
  await logRun({
    agentName: "Agent 17 — Deliverability SRE",
    recordsProcessed: b2bRows.length + distRows.length,
    emailsSent: 0,
    errors: "",
    status: "Success",
    notes: `blocked_domains_added=${blockedDomainsAdded.length}; blocked_sources_added=${blockedSourcesAdded.length}; active_domains=${Object.keys(saved.blockedDomains || {}).length}.`,
  });

  return {
    title,
    blockedDomainsAdded,
    blockedSourcesAdded,
    activeBlockedDomains: Object.keys(saved.blockedDomains || {}).length,
    activeBlockedSources: Object.keys(saved.blockedSources || {}).length,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// V2 AGENTS (A23–A30) — Deal Progression, Quotes, Fulfillment, Re-engagement
// ═══════════════════════════════════════════════════════════════════════

async function runDealProgressionTracker(dryRun = false) {
  const rows = [
    ...(await queryDatabaseAll(IDS.b2bProspects, { property: "Status", select: { equals: "Replied - Interested" } })),
    ...(await queryDatabaseAll(IDS.distributorProspects, { property: "Status", select: { equals: "Replied - Interested" } })),
  ];

  const nudgeCandidates = [];
  for (const row of rows) {
    const email = getPlainText(row.properties?.Email);
    if (!email) continue;
    const replyDate = row.properties?.["Date Follow-Up Sent"]?.date?.start
      || row.properties?.["Date First Contacted"]?.date?.start;
    if (!replyDate) continue;
    const age = daysSince(replyDate);
    if (age < 2) continue; // not stale yet
    const isDistributor = !row.properties?.["Business Name"];
    const name = getPlainText(row.properties?.["Contact Name"]) || getPlainText(row.properties?.["Business Name"]) || getPlainText(row.properties?.["Company Name"]) || "there";
    const firstName = getFirstName(name);
    const templateKey = isDistributor ? "distributorNudge" : "b2bNudge";
    const template = TEMPLATE_LIBRARY[templateKey];
    if (!template) continue;
    const subject = template.subject;
    const body = renderTemplate(template.body, { "First Name": firstName, email: "marketing@usagummies.com", phone: "435-896-7765" });
    nudgeCandidates.push({ row, email, firstName, subject, body, isDistributor, ageDays: age, pageId: row.id });
  }

  // Queue to attention queue for Ben's approval
  let queued = 0;
  for (const c of nudgeCandidates.slice(0, 10)) {
    if (dryRun) {
      log(`[A23 DRY-RUN] Would queue nudge for ${c.email} (${c.ageDays}d stale)`);
      queued++;
      continue;
    }
    queueReplyAttention({
      email: c.email,
      name: c.firstName,
      reason: `deal-nudge: interested ${c.ageDays}d ago, no follow-up`,
      draftSubject: c.subject,
      draftBody: c.body,
      source: "agent23",
      queuedAt: nowETTimestamp(),
    });
    queued++;
  }

  await logRun({
    agentName: "Agent 23 — Deal Progression Tracker",
    recordsProcessed: rows.length,
    emailsSent: 0,
    errors: "",
    status: "Success",
    notes: `interested_prospects=${rows.length}; stale_48h=${nudgeCandidates.length}; queued_nudges=${queued}; dry_run=${dryRun}.`,
  });

  return { interested: rows.length, stale: nudgeCandidates.length, queued };
}

async function runPricingQuoteGenerator(dryRun = false) {
  const b2bRows = await queryDatabaseAll(IDS.b2bProspects, {
    and: [
      { property: "Status", select: { equals: "Replied - Interested" } },
      { property: "Quote Sent", checkbox: { equals: false } },
    ],
  });

  // Also check for "Quote Requested" in Notes
  const candidates = b2bRows.filter((r) => {
    const notes = getPlainText(r.properties?.Notes) || "";
    return notes.toLowerCase().includes("quote") || notes.toLowerCase().includes("pricing");
  });

  let quotesSent = 0;
  const pendingQuotes = safeJsonRead(QUOTES_PENDING_FILE, []);

  for (const row of candidates.slice(0, 5)) {
    const email = getPlainText(row.properties?.Email);
    if (!email) continue;
    const name = getPlainText(row.properties?.["Contact Name"]) || "there";
    const firstName = getFirstName(name);
    const businessName = getPlainText(row.properties?.["Business Name"]) || "";

    // Standard quantity pricing
    const quoteDetails = [
      "Wholesale Pricing — All American Gummy Bears (7.5 oz bags):",
      "  1–24 bags: $3.49/bag",
      "  25–99 bags: $3.29/bag",
      "  100–499 bags: $2.99/bag",
      "  500+ bags: $2.79/bag",
      "",
      "Free shipping on orders over 100 bags.",
      "All prices NET 30 for approved accounts.",
    ].join("\n");

    const template = TEMPLATE_LIBRARY.b2bQuoteAttached;
    const body = renderTemplate(template.body, {
      "First Name": firstName,
      "Quote Details": quoteDetails,
      email: "marketing@usagummies.com",
      phone: "435-896-7765",
    });

    if (dryRun) {
      log(`[A24 DRY-RUN] Would queue quote email for ${email} (${businessName})`);
      quotesSent++;
      continue;
    }

    queueReplyAttention({
      email,
      name: firstName,
      reason: `quote-ready: pricing quote prepared for ${businessName}`,
      draftSubject: template.subject,
      draftBody: body,
      source: "agent24",
      queuedAt: nowETTimestamp(),
    });

    pendingQuotes.push({
      email,
      businessName,
      pageId: row.id,
      quoteDate: todayET(),
      amount: "standard-tier",
    });
    quotesSent++;
  }

  safeJsonWrite(QUOTES_PENDING_FILE, pendingQuotes);

  await logRun({
    agentName: "Agent 24 — Pricing & Quote Generator",
    recordsProcessed: b2bRows.length,
    emailsSent: 0,
    errors: "",
    status: "Success",
    notes: `quote_candidates=${candidates.length}; quotes_queued=${quotesSent}; dry_run=${dryRun}.`,
  });

  return { candidates: candidates.length, quotesSent };
}

async function runOrderFulfillmentBridge() {
  // Load Shopify Admin credentials from env
  const envPath = path.join(HOME, ".config/usa-gummies-mcp/.env-daily-report");
  let shopifyDomain = "usa-gummies.myshopify.com";
  let shopifyToken = "";
  try {
    const envContent = fs.readFileSync(envPath, "utf8");
    for (const line of envContent.split("\n")) {
      const [k, ...v] = line.split("=");
      const key = k.trim();
      const val = v.join("=").trim().replace(/^"|"$/g, "");
      if (key === "SHOPIFY_ADMIN_TOKEN") shopifyToken = val;
      if (key === "SHOPIFY_STORE_DOMAIN") shopifyDomain = val || shopifyDomain;
    }
  } catch { /* fallback */ }

  if (!shopifyToken) {
    log("[A25] No SHOPIFY_ADMIN_TOKEN found — skipping.");
    await logRun({ agentName: "Agent 25 — Order Fulfillment Bridge", recordsProcessed: 0, emailsSent: 0, errors: "No Shopify token", status: "Partial", notes: "Missing SHOPIFY_ADMIN_TOKEN." });
    return { orders: 0 };
  }

  // Fetch recent orders (last 7 days)
  const sinceDate = addDaysToDate(todayET(), -7);
  const ordersUrl = `https://${shopifyDomain}/admin/api/2025-01/orders.json?status=any&created_at_min=${sinceDate}T00:00:00-05:00&limit=50`;
  const ordersRes = await fetchWithTimeout(ordersUrl, {
    headers: { "X-Shopify-Access-Token": shopifyToken, "Content-Type": "application/json" },
  });
  if (!ordersRes.ok) {
    log(`[A25] Shopify API error: ${ordersRes.status}`);
    await logRun({ agentName: "Agent 25 — Order Fulfillment Bridge", recordsProcessed: 0, emailsSent: 0, errors: `HTTP ${ordersRes.status}`, status: "Failed", notes: "Shopify orders API failed." });
    return { orders: 0 };
  }

  const { orders = [] } = await ordersRes.json();

  // Cross-reference with Notion B2B prospects
  const b2bRows = await queryDatabaseAll(IDS.b2bProspects);
  const b2bEmailMap = {};
  for (const row of b2bRows) {
    const email = normalizeEmail(getPlainText(row.properties?.Email));
    if (email) b2bEmailMap[email] = row;
  }

  let matched = 0;
  for (const order of orders) {
    const orderEmail = normalizeEmail(order.email || "");
    const prospect = b2bEmailMap[orderEmail];
    if (!prospect) continue;

    const currentStatus = prospect.properties?.Status?.select?.name || "";
    if (currentStatus === "Order Placed") continue; // already tracked

    const orderValue = parseFloat(order.total_price || 0);
    const shopifyOrderId = `#${order.order_number}`;

    // Update Notion record
    await updatePage(prospect.id, buildProperties(IDS.b2bProspects, {
      Status: "Order Placed",
      "Order Value": orderValue,
      "Order Date": todayET(),
      "Shopify Order ID": shopifyOrderId,
    }));

    log(`[A25] Matched Shopify order ${shopifyOrderId} ($${orderValue}) to prospect ${orderEmail}`);
    matched++;
  }

  await logRun({
    agentName: "Agent 25 — Order Fulfillment Bridge",
    recordsProcessed: orders.length,
    emailsSent: 0,
    errors: "",
    status: "Success",
    notes: `shopify_orders_scanned=${orders.length}; matched_to_prospects=${matched}.`,
  });

  return { ordersScanned: orders.length, matched };
}

async function runWinLossAnalyzer() {
  const sevenDaysAgo = addDaysToDate(todayET(), -7);
  const allB2B = await queryDatabaseAll(IDS.b2bProspects);
  const allDist = await queryDatabaseAll(IDS.distributorProspects);

  const lostB2B = allB2B.filter((r) => {
    const status = r.properties?.Status?.select?.name || "";
    if (status !== "Replied - Not Interested" && status !== "Bounced") return false;
    const contacted = r.properties?.["Date First Contacted"]?.date?.start;
    return contacted && contacted >= sevenDaysAgo;
  });

  const lostDist = allDist.filter((r) => {
    const status = r.properties?.Status?.select?.name || "";
    if (status !== "Replied - Not Interested" && status !== "Bounced") return false;
    const contacted = r.properties?.["Date First Contacted"]?.date?.start;
    return contacted && contacted >= sevenDaysAgo;
  });

  // Analyze patterns
  const stateCount = {};
  const typeCount = {};
  const bounceCount = { b2b: 0, dist: 0 };
  const notInterestedCount = { b2b: 0, dist: 0 };

  for (const r of lostB2B) {
    const state = getPlainText(r.properties?.State) || "Unknown";
    const type = r.properties?.["Business Type"]?.select?.name || "Unknown";
    const status = r.properties?.Status?.select?.name || "";
    stateCount[state] = (stateCount[state] || 0) + 1;
    typeCount[type] = (typeCount[type] || 0) + 1;
    if (status === "Bounced") bounceCount.b2b++;
    else notInterestedCount.b2b++;
  }
  for (const r of lostDist) {
    const state = getPlainText(r.properties?.State) || "Unknown";
    stateCount[state] = (stateCount[state] || 0) + 1;
    const status = r.properties?.Status?.select?.name || "";
    if (status === "Bounced") bounceCount.dist++;
    else notInterestedCount.dist++;
  }

  const topStates = Object.entries(stateCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topTypes = Object.entries(typeCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const title = `${todayLongET()} — Win/Loss Analysis`;
  const blocks = [
    blockHeading("Weekly Win/Loss Summary"),
    blockParagraph(`Period: ${sevenDaysAgo} to ${todayET()}`),
    blockParagraph(`B2B losses: ${lostB2B.length} (${notInterestedCount.b2b} not interested, ${bounceCount.b2b} bounced)`),
    blockParagraph(`Distributor losses: ${lostDist.length} (${notInterestedCount.dist} not interested, ${bounceCount.dist} bounced)`),
    blockHeading("Loss Patterns — Top States"),
    ...(topStates.length ? topStates.map(([s, c]) => blockParagraph(`${s}: ${c}`)) : [blockParagraph("No patterns detected.")]),
    blockHeading("Loss Patterns — Top Business Types"),
    ...(topTypes.length ? topTypes.map(([t, c]) => blockParagraph(`${t}: ${c}`)) : [blockParagraph("N/A")]),
  ];

  await createPageInDb(IDS.dailyReports, buildProperties(IDS.dailyReports, { Name: title }), blocks);

  await logRun({
    agentName: "Agent 26 — Win/Loss Analyzer",
    recordsProcessed: lostB2B.length + lostDist.length,
    emailsSent: 0,
    errors: "",
    status: "Success",
    notes: `b2b_losses=${lostB2B.length}; dist_losses=${lostDist.length}; period=${sevenDaysAgo}..${todayET()}.`,
  });

  return { b2bLosses: lostB2B.length, distLosses: lostDist.length, topStates, topTypes };
}

async function runReengagementCampaigner(dryRun = false) {
  const reengagementLog = safeJsonRead(REENGAGEMENT_LOG_FILE, {});
  const sixtyDaysAgo = addDaysToDate(todayET(), -60);

  const candidates = [];
  const b2bRows = await queryDatabaseAll(IDS.b2bProspects, { property: "Status", select: { equals: "Replied - Not Interested" } });

  for (const row of b2bRows) {
    const email = getPlainText(row.properties?.Email);
    if (!email) continue;
    const contacted = row.properties?.["Date First Contacted"]?.date?.start;
    if (!contacted || contacted > sixtyDaysAgo) continue; // not old enough
    const reCount = row.properties?.["Re-engagement Count"]?.number || 0;
    if (reCount >= 2) continue; // max 2 re-engagement attempts
    const lastReengaged = reengagementLog[email];
    if (lastReengaged && daysSince(lastReengaged) < 60) continue;
    const name = getPlainText(row.properties?.["Contact Name"]) || "there";
    candidates.push({ row, email, firstName: getFirstName(name), pageId: row.id, reCount });
  }

  let queued = 0;
  const MAX_DAILY = 5;
  for (const c of candidates.slice(0, MAX_DAILY)) {
    const template = TEMPLATE_LIBRARY.b2bReengagement;
    const body = renderTemplate(template.body, { "First Name": c.firstName, email: "marketing@usagummies.com", phone: "435-896-7765" });

    if (dryRun) {
      log(`[A27 DRY-RUN] Would queue re-engagement for ${c.email}`);
      queued++;
      continue;
    }

    queueReplyAttention({
      email: c.email,
      name: c.firstName,
      reason: `re-engagement: not-interested >60d ago (attempt ${c.reCount + 1}/2)`,
      draftSubject: template.subject,
      draftBody: body,
      source: "agent27",
      queuedAt: nowETTimestamp(),
    });

    reengagementLog[c.email] = todayET();
    await updatePage(c.pageId, buildProperties(IDS.b2bProspects, { "Re-engagement Count": c.reCount + 1 }));
    queued++;
  }

  safeJsonWrite(REENGAGEMENT_LOG_FILE, reengagementLog);

  await logRun({
    agentName: "Agent 27 — Re-engagement Campaigner",
    recordsProcessed: b2bRows.length,
    emailsSent: 0,
    errors: "",
    status: "Success",
    notes: `not_interested_pool=${b2bRows.length}; eligible_60d=${candidates.length}; queued=${queued}; dry_run=${dryRun}.`,
  });

  return { pool: b2bRows.length, eligible: candidates.length, queued };
}

async function runFaireOrderMonitor() {
  // Faire API polling — check for new orders via the open API
  const faireOrders = safeJsonRead(FAIRE_ORDERS_FILE, { knownOrderIds: [], lastCheck: "" });
  let newOrders = 0;

  // Attempt Faire API call
  const credsPath = path.join(HOME, ".config/usa-gummies-mcp/.faire-credentials");
  let faireToken = "";
  try {
    const credsContent = fs.readFileSync(credsPath, "utf8");
    for (const line of credsContent.split("\n")) {
      const [k, ...v] = line.split("=");
      if (k.trim() === "FAIRE_API_TOKEN") faireToken = v.join("=").trim().replace(/^"|"$/g, "");
    }
  } catch { /* no Faire token */ }

  if (faireToken) {
    try {
      const faireRes = await fetchWithTimeout("https://www.faire.com/external-api/v2/orders?limit=20", {
        headers: { "X-FAIRE-ACCESS-TOKEN": faireToken, Accept: "application/json" },
      });
      if (faireRes.ok) {
        const data = await faireRes.json();
        const orders = data.orders || [];
        for (const order of orders) {
          const orderId = order.id || order.order_id;
          if (!orderId || faireOrders.knownOrderIds.includes(orderId)) continue;
          faireOrders.knownOrderIds.push(orderId);
          newOrders++;
          const brandTotal = order.payout_costs?.total_payout_cents
            ? (order.payout_costs.total_payout_cents / 100).toFixed(2)
            : "unknown";
          log(`[A28] New Faire order: ${orderId} — $${brandTotal}`);

          // Create Notion entry in distributor DB
          await createPageInDb(IDS.distributorProspects, buildProperties(IDS.distributorProspects, {
            "Company Name": `Faire Order ${orderId}`,
            Status: "Order Placed",
            Source: "Faire",
            "Faire Order ID": orderId,
            Notes: `Auto-created from Faire. Payout: $${brandTotal}.`,
            "Date First Contacted": todayET(),
          }));
        }
      } else {
        log(`[A28] Faire API returned ${faireRes.status}`);
      }
    } catch (err) {
      log(`[A28] Faire API error: ${err.message}`);
    }
  } else {
    log("[A28] No Faire API token found — skipping API poll.");
  }

  faireOrders.lastCheck = nowETTimestamp();
  safeJsonWrite(FAIRE_ORDERS_FILE, faireOrders);

  await logRun({
    agentName: "Agent 28 — Faire Order Monitor",
    recordsProcessed: 0,
    emailsSent: 0,
    errors: faireToken ? "" : "No Faire token",
    status: faireToken ? "Success" : "Partial",
    notes: `new_orders=${newOrders}; total_known=${faireOrders.knownOrderIds.length}.`,
  });

  return { newOrders, totalKnown: faireOrders.knownOrderIds.length };
}

async function runTemplateABRotator() {
  const perf = safeJsonRead(TEMPLATE_PERFORMANCE_FILE, { variants: {}, rotations: [] });
  const ledger = loadRunLedger();

  // Analyze email performance by template variant
  // Count sends and replies for b2b/distributor initial templates
  const b2bRows = await queryDatabaseAll(IDS.b2bProspects);
  const variantStats = { A: { sent: 0, replied: 0 }, B: { sent: 0, replied: 0 } };

  for (const row of b2bRows) {
    const variant = row.properties?.["Template Variant"]?.select?.name;
    if (!variant || !variantStats[variant]) continue;
    variantStats[variant].sent++;
    const replied = row.properties?.["Reply Received"]?.checkbox;
    if (replied) variantStats[variant].replied++;
  }

  // Calculate reply rates
  const rateA = variantStats.A.sent > 0 ? (variantStats.A.replied / variantStats.A.sent * 100) : 0;
  const rateB = variantStats.B.sent > 0 ? (variantStats.B.replied / variantStats.B.sent * 100) : 0;

  let rotationAction = "none";
  // Only rotate if we have enough data (at least 20 sends per variant)
  if (variantStats.A.sent >= 20 && variantStats.B.sent >= 20) {
    if (rateA > rateB + 2) {
      rotationAction = "favor-A";
    } else if (rateB > rateA + 2) {
      rotationAction = "favor-B";
    }
  }

  perf.variants = variantStats;
  perf.lastAnalysis = todayET();
  if (rotationAction !== "none") {
    perf.rotations.push({ date: todayET(), action: rotationAction, rateA: rateA.toFixed(1), rateB: rateB.toFixed(1) });
  }
  safeJsonWrite(TEMPLATE_PERFORMANCE_FILE, perf);

  const title = `${todayLongET()} — Template A/B Analysis`;
  const blocks = [
    blockHeading("Template Performance"),
    blockParagraph(`Variant A: ${variantStats.A.sent} sent, ${variantStats.A.replied} replied (${rateA.toFixed(1)}% reply rate)`),
    blockParagraph(`Variant B: ${variantStats.B.sent} sent, ${variantStats.B.replied} replied (${rateB.toFixed(1)}% reply rate)`),
    blockParagraph(`Rotation decision: ${rotationAction}`),
  ];

  await createPageInDb(IDS.dailyReports, buildProperties(IDS.dailyReports, { Name: title }), blocks);

  await logRun({
    agentName: "Agent 29 — Template A/B Rotator",
    recordsProcessed: b2bRows.length,
    emailsSent: 0,
    errors: "",
    status: "Success",
    notes: `variant_A=${variantStats.A.sent}sent/${variantStats.A.replied}replied; variant_B=${variantStats.B.sent}sent/${variantStats.B.replied}replied; rotation=${rotationAction}.`,
  });

  return { variantStats, rateA: rateA.toFixed(1), rateB: rateB.toFixed(1), rotationAction };
}

async function runContactEnrichmentAgent(limit = 20) {
  // Find prospects with email but no phone
  const b2bRows = await queryDatabaseAll(IDS.b2bProspects);
  const distRows = await queryDatabaseAll(IDS.distributorProspects);

  const needsPhone = [];
  for (const row of [...b2bRows, ...distRows]) {
    const email = getPlainText(row.properties?.Email);
    const phone = getPlainText(row.properties?.Phone);
    if (email && !phone) {
      const name = getPlainText(row.properties?.["Business Name"]) || getPlainText(row.properties?.["Company Name"]) || "";
      needsPhone.push({ row, email, name, pageId: row.id, isDistributor: !row.properties?.["Business Name"] });
    }
  }

  let enriched = 0;
  for (const prospect of needsPhone.slice(0, limit)) {
    // Attempt web search for phone number
    const query = `"${prospect.name}" phone number contact`;
    try {
      const results = await searchWeb(query, 5);
      for (const result of results) {
        // Look for phone pattern in snippet
        const phoneMatch = (result.snippet || "").match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
        if (phoneMatch) {
          const foundPhone = phoneMatch[0];
          const dbId = prospect.isDistributor ? IDS.distributorProspects : IDS.b2bProspects;
          await updatePage(prospect.pageId, buildProperties(dbId, { Phone: foundPhone }));
          log(`[A30] Enriched ${prospect.email} with phone: ${foundPhone}`);
          enriched++;
          break;
        }
      }
    } catch (err) {
      log(`[A30] Search failed for ${prospect.name}: ${err.message}`);
    }
  }

  await logRun({
    agentName: "Agent 30 — Contact Enrichment",
    recordsProcessed: Math.min(needsPhone.length, limit),
    emailsSent: 0,
    errors: "",
    status: "Success",
    notes: `missing_phone=${needsPhone.length}; searched=${Math.min(needsPhone.length, limit)}; enriched=${enriched}.`,
  });

  return { missingPhone: needsPhone.length, searched: Math.min(needsPhone.length, limit), enriched };
}

function normalizeAgentKey(name) {
  const value = String(name || "").toLowerCase().trim();
  const aliases = {
    "0": "agent0",
    audit: "agent0",
    agent0: "agent0",
    "1": "agent1",
    agent1: "agent1",
    "2": "agent2",
    agent2: "agent2",
    "22": "agent22",
    seed: "agent22",
    seeder: "agent22",
    reference: "agent22",
    references: "agent22",
    agent22: "agent22",
    "3": "agent3",
    agent3: "agent3",
    "4": "agent4",
    agent4: "agent4",
    "5": "agent5",
    agent5: "agent5",
    "6": "agent6",
    agent6: "agent6",
    "7": "agent7",
    agent7: "agent7",
    "8": "agent8",
    agent8: "agent8",
    "9": "agent9",
    agent9: "agent9",
    "11": "agent11",
    forecast: "agent11",
    attribution: "agent11",
    revenue: "agent11",
    agent11: "agent11",
    "12": "agent12",
    verifier: "agent12",
    verification: "agent12",
    quality: "agent12",
    agent12: "agent12",
    "13": "agent13",
    enforcer: "agent13",
    quota: "agent13",
    floor: "agent13",
    agent13: "agent13",
    "18": "agent18",
    dedupe: "agent18",
    noresend: "agent18",
    no_resend: "agent18",
    guard: "agent18",
    agent18: "agent18",
    "19": "agent19",
    master: "agent19",
    mastersync: "agent19",
    notion: "agent19",
    notion_sync: "agent19",
    notionsync: "agent19",
    agent19: "agent19",
    "20": "agent20",
    gate: "agent20",
    preflight: "agent20",
    sendgate: "agent20",
    queue: "agent20",
    agent20: "agent20",
    "21": "agent21",
    pulse: "agent21",
    pipeline: "agent21",
    refill: "agent21",
    agent21: "agent21",
    "16": "agent16",
    governor: "agent16",
    kpi: "agent16",
    agent16: "agent16",
    "17": "agent17",
    sre: "agent17",
    deliverability: "agent17",
    agent17: "agent17",
    "10": "agent10",
    health: "agent10",
    selfheal: "agent10",
    self_heal: "agent10",
    agent10: "agent10",
    "23": "agent23",
    deal: "agent23",
    progression: "agent23",
    nudge: "agent23",
    agent23: "agent23",
    "24": "agent24",
    pricing: "agent24",
    quote: "agent24",
    quotes: "agent24",
    agent24: "agent24",
    "25": "agent25",
    fulfillment: "agent25",
    bridge: "agent25",
    orders: "agent25",
    agent25: "agent25",
    "26": "agent26",
    winloss: "agent26",
    win_loss: "agent26",
    analysis: "agent26",
    agent26: "agent26",
    "27": "agent27",
    reengage: "agent27",
    reengagement: "agent27",
    agent27: "agent27",
    "28": "agent28",
    faire: "agent28",
    agent28: "agent28",
    "29": "agent29",
    ab: "agent29",
    rotator: "agent29",
    template: "agent29",
    agent29: "agent29",
    "30": "agent30",
    enrich: "agent30",
    enrichment: "agent30",
    phone: "agent30",
    agent30: "agent30",
  };
  return aliases[value] || "";
}

function buildAgentHandlers(opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  return {
    agent0: () => runEmailAudit(),
    agent1: () => runB2BResearcher(Number(opts.target || 40), { recovery: Boolean(opts.recovery) }),
    agent22: () => runDistributorReferenceSeeder(Number(opts.limit || 8)),
    agent2: () => runDistributorResearcher(Number(opts.target || 10), { recovery: Boolean(opts.recovery) }),
    agent3: () => runB2BEmailSender(Number(opts.limit || 25), dryRun),
    agent4: () => runDistributorEmailSender(Number(opts.limit || 10), dryRun),
    agent5: () => runFollowUpAgent(dryRun),
    agent6: () =>
      runInboxMonitor({
        backfill: Boolean(opts.backfill),
        count: Number(opts.count || 0),
        maxProcessed: Number(opts.maxProcessed || 0),
      }),
    agent7: () => runDailyPerformanceReport(),
    agent8: () => runCustomerLearningAgent(),
    agent9: () => runBounceIntelligenceAgent(),
    agent11: () => runRevenueAttributionForecastAgent(),
    agent12: () => runBalancedContactVerifierAgent(Number(opts.limit || 250)),
    agent13: () => runQuotaFloorEnforcerAgent(dryRun),
    agent18: () => runNoResendGuardAgent(Number(opts.limit || 600)),
    agent19: () => runNotionMasterSyncAgent(Number(opts.limit || 800)),
    agent20: () => runSendQueueGateAgent(Number(opts.limit || 600)),
    agent21: () => runPipelinePulseAgent(dryRun),
    agent16: () => runKpiGovernorAgent(),
    agent17: () => runDeliverabilitySreAgent(),
    agent23: () => runDealProgressionTracker(dryRun),
    agent24: () => runPricingQuoteGenerator(dryRun),
    agent25: () => runOrderFulfillmentBridge(),
    agent26: () => runWinLossAnalyzer(),
    agent27: () => runReengagementCampaigner(dryRun),
    agent28: () => runFaireOrderMonitor(),
    agent29: () => runTemplateABRotator(),
    agent30: () => runContactEnrichmentAgent(Number(opts.limit || 20)),
  };
}

function summarizeAgentResult(result) {
  if (!result || typeof result !== "object") return "";
  if (typeof result.added === "number") return `added=${result.added}`;
  if (typeof result.sent === "number") return `sent=${result.sent}`;
  if (typeof result.processed === "number") return `processed=${result.processed}`;
  if (typeof result.reviewed === "number") return `reviewed=${result.reviewed}`;
  if (typeof result.b2bCount === "number" || typeof result.distributorCount === "number") {
    return `b2b=${result.b2bCount ?? "-"} distributor=${result.distributorCount ?? "-"}`;
  }
  return Object.keys(result).slice(0, 3).join(",");
}

async function runSingleAgentWithMonitoring(agentKey, handler, context = {}) {
  const startedAt = Date.now();
  updateAgentStatus(agentKey, {
    lastStatus: "running",
    source: context.source || "manual",
    summary: "run started",
  });
  try {
    const result = await handler();
    const durationMs = Date.now() - startedAt;
    const normalizedStatus = normalizeRunStatus(result?.status);
    const resultErrors = [
      ...(Array.isArray(result?.errors) ? result.errors : []),
      ...(Array.isArray(result?.failures) ? result.failures : []),
    ]
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    updateAgentStatus(agentKey, {
      lastStatus: normalizedStatus,
      lastDurationMs: durationMs,
      source: context.source || "manual",
      summary: summarizeAgentResult(result),
      lastError: normalizedStatus === "success" ? "" : resultErrors.slice(0, 3).join(" | "),
      lastResult: result,
    });
    appendRunLedger({
      runAt: new Date().toISOString(),
      runAtET: nowETTimestamp(),
      runDateET: todayET(),
      agent: agentKey,
      label: SCHEDULE_PLAN[agentKey]?.label || agentKey,
      source: context.source || "manual",
      status: normalizedStatus,
      durationMs,
      result,
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = String(err?.message || err || "unknown_error");
    updateAgentStatus(agentKey, {
      lastStatus: "failed",
      lastDurationMs: durationMs,
      source: context.source || "manual",
      summary: `error=${message.slice(0, 160)}`,
      lastError: message,
    });
    appendRunLedger({
      runAt: new Date().toISOString(),
      runAtET: nowETTimestamp(),
      runDateET: todayET(),
      agent: agentKey,
      label: SCHEDULE_PLAN[agentKey]?.label || agentKey,
      source: context.source || "manual",
      status: "failed",
      durationMs,
      error: message,
    });
    throw err;
  }
}

function selfHealOptionsFor(agentKey) {
  if (agentKey === "agent1") return { target: 12 };
  if (agentKey === "agent22") return { limit: 5 };
  if (agentKey === "agent2") return { target: 6 };
  if (agentKey === "agent12") return { limit: 120 };
  if (agentKey === "agent19") return { limit: 300 };
  if (agentKey === "agent18") return { limit: 300 };
  if (agentKey === "agent20") return { limit: 300 };
  if (agentKey === "agent3") return { limit: 12 };
  if (agentKey === "agent4") return { limit: 6 };
  if (agentKey === "agent21") return { dryRun: true };
  return {};
}

function shouldRepairAgentNow(agentKey, agentState, nowET) {
  const schedule = SCHEDULE_PLAN[agentKey];
  if (!schedule) return false;
  if (!agentState) return false;
  if (agentState.lastStatus === "running") return false;
  const lastRunMs = agentState.lastRunAt ? Date.parse(agentState.lastRunAt) : 0;
  const ageMin = lastRunMs ? (Date.now() - lastRunMs) / 60000 : Number.POSITIVE_INFINITY;

  if (schedule.intervalMinutes) {
    if (!lastRunMs) return true;
    return ageMin > schedule.graceMinutes;
  }

  const scheduledMinutes = schedule.hour * 60 + schedule.minute;
  const nowMinutes = nowET.minutesOfDay;
  const today = nowET.date;
  const hasRunToday = agentState.lastRunDateET === today;
  if (hasRunToday && agentState.lastStatus === "failed" && ageMin > 30) return true;
  if (
    hasRunToday &&
    agentState.lastStatus === "partial" &&
    ["agent1", "agent22", "agent2", "agent3", "agent4", "agent13", "agent21"].includes(agentKey) &&
    ageMin > 60
  ) {
    return true;
  }
  if (nowMinutes < scheduledMinutes + schedule.graceMinutes) return false;
  return !hasRunToday;
}

/**
 * processApprovedSends — reads reply-approved-sends.json written by the dashboard
 * and sends each approved reply email. Marks sent items so they are not re-processed.
 * Called by the self-heal agent (every 30 min) so Ben's approvals go out quickly.
 */
async function processApprovedSends() {
  if (!fs.existsSync(APPROVED_SENDS_FILE)) return { processed: 0, sent: 0, errors: [] };

  let items;
  try {
    const raw = fs.readFileSync(APPROVED_SENDS_FILE, "utf8");
    items = JSON.parse(raw);
    if (!Array.isArray(items)) return { processed: 0, sent: 0, errors: [] };
  } catch {
    return { processed: 0, sent: 0, errors: [] };
  }

  const pending = items.filter((i) => i.status === "authorized" && !i.sentAt);
  if (pending.length === 0) return { processed: 0, sent: 0, errors: [] };

  const errors = [];
  let sent = 0;

  for (const item of pending) {
    try {
      const result = sendEmail({
        to: item.senderEmail,
        subject: item.draftSubject,
        body: item.draftBody,
        dryRun: false,
      });
      if (result.ok) {
        item.sentAt = new Date().toISOString();
        item.status = "sent";
        sent += 1;
        log(`[approved-sends] Sent reply to ${item.senderEmail}: ${item.draftSubject}`);
      } else {
        errors.push(`${item.senderEmail}: send_failed`);
        item.sendError = (result.output || "").slice(0, 200);
      }
    } catch (err) {
      errors.push(`${item.senderEmail}: ${String(err?.message || err).slice(0, 120)}`);
    }
  }

  // Persist updated statuses back to the file
  try {
    fs.writeFileSync(APPROVED_SENDS_FILE, JSON.stringify(items, null, 2), "utf8");
  } catch (err) {
    errors.push(`file_write_failed: ${String(err?.message || err).slice(0, 80)}`);
  }

  return { processed: pending.length, sent, errors };
}

async function runSelfHealAgent() {
  if (!tryAcquireSelfHealLock()) {
    await logRun({
      agentName: "Agent 10 — Self-Heal Monitor",
      recordsProcessed: 0,
      emailsSent: 0,
      errors: "",
      status: "Partial",
      notes: "Skipped: self-heal lock is active.",
    });
    return { skipped: true, reason: "lock_active", repaired: [] };
  }

  try {
    // Always flush any Ben-approved reply sends first — these are human-authorized and time-sensitive
    const approvedSendResult = await processApprovedSends();
    if (approvedSendResult.sent > 0 || approvedSendResult.errors.length > 0) {
      log(`[self-heal] Approved sends: processed=${approvedSendResult.processed} sent=${approvedSendResult.sent} errors=${approvedSendResult.errors.length}`);
    }

    const status = loadSystemStatus();
    const nowET = etParts(new Date());
    const handlers = buildAgentHandlers({});
    const candidates = ["agent7", "agent1", "agent22", "agent2", "agent12", "agent0", "agent19", "agent18", "agent20", "agent3", "agent4", "agent13", "agent21", "agent5", "agent6", "agent8", "agent9", "agent11", "agent16", "agent17"];
    const repaired = [];
    const failed = [];

    for (const agentKey of candidates) {
      if (!shouldRepairAgentNow(agentKey, status.agents?.[agentKey], nowET)) continue;
      const handler = handlers[agentKey];
      if (!handler) continue;
      const options = selfHealOptionsFor(agentKey);
      try {
        const targetedHandler = buildAgentHandlers(options)[agentKey];
        const result = await runSingleAgentWithMonitoring(agentKey, targetedHandler, { source: "self-heal" });
        repaired.push({ agent: agentKey, summary: summarizeAgentResult(result) });
      } catch (err) {
        failed.push({ agent: agentKey, error: String(err?.message || err).slice(0, 180) });
      }
    }

    const refreshed = loadSystemStatus();
    refreshed.selfHeal = {
      lastRunAt: new Date().toISOString(),
      lastActionSummary: `repaired=${repaired.length}; failed=${failed.length}`,
      actions: [...repaired.map((x) => `repaired:${x.agent}:${x.summary}`), ...failed.map((x) => `failed:${x.agent}:${x.error}`)].slice(-30),
    };
    saveSystemStatus(refreshed);

    const runStatus = failed.length > 0 ? (repaired.length > 0 ? "Partial" : "Failed") : "Success";
    await logRun({
      agentName: "Agent 10 — Self-Heal Monitor",
      recordsProcessed: repaired.length,
      emailsSent: 0,
      errors: failed.map((x) => `${x.agent}:${x.error}`).join(" | "),
      status: runStatus,
      notes: `Repaired: ${repaired.map((x) => x.agent).join(",") || "none"}. Approved-sends: processed=${approvedSendResult.processed} sent=${approvedSendResult.sent}.`,
    });

    return { skipped: false, repaired, failed };
  } finally {
    releaseSelfHealLock();
  }
}

async function publishInitializationReport(schemaResult) {
  const schedules = [
    "Agent 7 - Daily Performance Report: 7:45 AM ET",
    "Agent 1 - B2B Business Researcher: 8:00 AM ET",
    "Agent 2 - Distributor Researcher: 8:30 AM ET",
    "Agent 12 - Balanced Contact Verifier: 8:40 AM ET",
    "Agent 0 - Email Audit: 8:50 AM ET",
    "Agent 19 - Notion Master Sync: 8:52 AM ET",
    "Agent 18 - No-Resend Guard: 8:55 AM ET",
    "Agent 20 - Send Queue Gate: 8:57 AM ET",
    "Agent 3 - B2B Email Sender: 9:00 AM ET",
    "Agent 4 - Distributor Email Sender: 9:15 AM ET",
    "Agent 13 - Quota Floor Enforcer: 11:00 AM ET and 2:30 PM ET",
    "Agent 21 - Pipeline Pulse (research top-up only): 3:30 PM ET",
    "Idle-Hour Research Backfill (Agent 1 + Agent 2): 20 minutes past each idle ET hour (0,1,2,3,4,5,6,10,12,15,19,20,21,22,23)",
    "Agent 5 - Follow-Up Agent: 1:00 PM ET",
    "Agent 6 - Inbox Monitor + Reply Logger: 4:00 PM ET",
    "Agent 8 - Customer Learning: 5:00 PM ET",
    "Agent 9 - Bounce Intelligence: 5:15 PM ET",
    "Agent 11 - Revenue Attribution Forecast: 5:30 PM ET",
    "Agent 16 - KPI Governor: 5:45 PM ET",
    "Agent 17 - Deliverability SRE: 6:00 PM ET",
    "Agent 6 (Backfill mode) - Inbox bounce/reply reconciliation: 6:20 PM ET",
    "Agent 10 - Self-Heal Monitor: Every 30 minutes ET",
  ];

  const title = `System Initialization — ${todayLongET()}`;
  const lines = [
    "Initialization complete for USA Gummies outreach automation.",
    "",
    "Databases and pages confirmed in USA Gummies workspace:",
    "- B2B CRM > Prospects (mapped to existing B2B Prospect Pipeline)",
    "- Distributor CRM > Prospects (mapped to existing Distributor Prospect Pipeline)",
    "- Agentic Operations > Agent Run Log (mapped to existing Fleet Operations Log)",
    "- Agentic Operations > Daily Performance Reports (mapped to existing Daily Performance Reports DB)",
    "- Repacker Location List (mapped to existing Repacker Network)",
    "- B2B CRM > Email Templates and Distributor CRM > Email Templates (mapped to existing Email Templates page)",
    "",
    `B2B schema updates: ${schemaResult.addedB2B.join(", ") || "none"}`,
    `Distributor schema updates: ${schemaResult.addedDist.join(", ") || "none"}`,
    `Run log schema updates: ${schemaResult.addedRun.join(", ") || "none"}`,
    `Template updates: ${schemaResult.templatePatched ? "required templates appended verbatim" : "already present"}`,
    "",
    "Scheduled run times (US Eastern Time):",
    ...schedules.map((s) => `- ${s}`),
    "",
    "Hard boundary enforced: no Rainier Luxury Retreats pages were accessed or modified.",
  ];

  await createPageInDb(IDS.dailyReports, buildProperties(IDS.dailyReports, { Name: title }), lines.map((x) => blockParagraph(x)));
  await logRun({
    agentName: "System Initialization",
    recordsProcessed: 0,
    emailsSent: 0,
    errors: "",
    status: "Success",
    notes: "Initialization report posted and schedule configured.",
  });

  return title;
}

async function runAgentByName(name, opts = {}) {
  const agentKey = normalizeAgentKey(name);
  if (!agentKey) throw new Error(`Unknown agent: ${name}`);
  if (agentKey === "agent10") {
    return runSingleAgentWithMonitoring("agent10", () => runSelfHealAgent(), { source: "scheduler" });
  }
  const handler = buildAgentHandlers(opts)[agentKey];
  if (!handler) throw new Error(`No handler for agent: ${agentKey}`);
  return runSingleAgentWithMonitoring(agentKey, handler, { source: opts.source || "manual" });
}

function parseArgs(argv) {
  const args = [...argv];
  const out = { cmd: args.shift() || "help" };
  while (args.length) {
    const a = args.shift();
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--backfill") out.backfill = true;
    else if (a === "--recovery") out.recovery = true;
    else if (a === "--limit") out.limit = Number(args.shift() || "0");
    else if (a === "--target") out.target = Number(args.shift() || "0");
    else if (a === "--count") out.count = Number(args.shift() || "0");
    else if (a === "--max-processed") out.maxProcessed = Number(args.shift() || "0");
    else if (a === "--source") out.source = String(args.shift() || "");
    else if (a === "--agent") out.agent = args.shift();
    else if (!out.arg) out.arg = a;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    const schemaResult = await ensureSchemasAndTemplates();
    saveSystemStatus(loadSystemStatus());

    if (args.cmd === "init") {
      const reportTitle = await publishInitializationReport(schemaResult);
      console.log(JSON.stringify({ ok: true, reportTitle, schemaResult }, null, 2));
      return;
    }

    if (args.cmd === "run-agent") {
      const agent = args.arg || args.agent;
      if (!agent) throw new Error("run-agent requires agent identifier (agent0..agent13,agent16..agent22)");
      const result = await runAgentByName(agent, args);
      console.log(JSON.stringify({ ok: true, agent, result }, null, 2));
      return;
    }

    if (args.cmd === "run-daily") {
      const result = {};
      result.agent7 = await runAgentByName("agent7", { source: "run-daily" });
      result.agent1 = await runAgentByName("agent1", { source: "run-daily", target: 40 });
      result.agent22 = await runAgentByName("agent22", { source: "run-daily", limit: 8 });
      result.agent2 = await runAgentByName("agent2", { source: "run-daily", target: 10 });
      result.agent12 = await runAgentByName("agent12", { source: "run-daily", limit: 250 });
      result.audit = await runAgentByName("agent0", { source: "run-daily" });
      result.agent19 = await runAgentByName("agent19", { source: "run-daily", limit: 800 });
      result.agent18 = await runAgentByName("agent18", { source: "run-daily", limit: 600 });
      result.agent20 = await runAgentByName("agent20", { source: "run-daily", limit: 600 });
      result.agent3 = await runAgentByName("agent3", { source: "run-daily", limit: 35, dryRun: Boolean(args.dryRun) });
      result.agent4 = await runAgentByName("agent4", { source: "run-daily", limit: 10, dryRun: Boolean(args.dryRun) });
      result.agent13 = await runAgentByName("agent13", { source: "run-daily", dryRun: Boolean(args.dryRun) });
      result.agent21 = await runAgentByName("agent21", { source: "run-daily", dryRun: Boolean(args.dryRun) });
      result.agent5 = await runAgentByName("agent5", { source: "run-daily", dryRun: Boolean(args.dryRun) });
      result.agent6 = await runAgentByName("agent6", { source: "run-daily" });
      result.agent8 = await runAgentByName("agent8", { source: "run-daily" });
      result.agent9 = await runAgentByName("agent9", { source: "run-daily" });
      result.agent11 = await runAgentByName("agent11", { source: "run-daily" });
      result.agent16 = await runAgentByName("agent16", { source: "run-daily" });
      result.agent17 = await runAgentByName("agent17", { source: "run-daily" });
      console.log(JSON.stringify({ ok: true, result }, null, 2));
      return;
    }

    if (args.cmd === "run-research-backfill") {
      const b2bTarget = Math.max(1, Number(args.target || 20));
      const distTarget = Math.max(1, Number(args.limit || 6));
      const result = {};
      result.agent1 = await runAgentByName("agent1", { source: args.source || "idle-hour-backfill", target: b2bTarget });
      result.agent2 = await runAgentByName("agent2", { source: args.source || "idle-hour-backfill", target: distTarget });
      console.log(JSON.stringify({ ok: true, backfill: true, b2bTarget, distTarget, result }, null, 2));
      return;
    }

    if (args.cmd === "status") {
      const [b2bRows, distRows] = await Promise.all([queryDatabaseAll(IDS.b2bProspects), queryDatabaseAll(IDS.distributorProspects)]);
      const b2bByStatus = countByStatus(b2bRows);
      const distributorByStatus = countByStatus(distRows);
      const traction = buildTractionSnapshot(b2bByStatus, distributorByStatus);
      const statusModel = loadSystemStatus();
      console.log(
        JSON.stringify(
          {
            todayET: todayET(),
            b2bCount: b2bRows.length,
            distributorCount: distRows.length,
            b2bByStatus,
            distributorByStatus,
            traction,
            proofOfLife: {
              lastHeartbeat: statusModel.heartbeat?.lastSeenAt || "",
              selfHealLastRun: statusModel.selfHeal?.lastRunAt || "",
            },
            agents: statusModel.agents || {},
          },
          null,
          2
        )
      );
      return;
    }

    if (args.cmd === "traction") {
      const [b2bRows, distRows] = await Promise.all([queryDatabaseAll(IDS.b2bProspects), queryDatabaseAll(IDS.distributorProspects)]);
      const b2bByStatus = countByStatus(b2bRows);
      const distributorByStatus = countByStatus(distRows);
      const traction = buildTractionSnapshot(b2bByStatus, distributorByStatus);
      console.log(JSON.stringify({ todayET: todayET(), traction }, null, 2));
      return;
    }

    if (args.cmd === "params") {
      console.log(
        JSON.stringify(
          {
            todayET: todayET(),
            research: RESEARCH_PARAMS,
            adaptiveTargeting: ADAPTIVE_PARAMS,
            sendingGuards: {
              requireValidEmailFormat: true,
              allowFreemailForSmallBusiness: true,
              requireDNSRouting: true,
              allowRoleUtilityMailboxes: true,
              hardBlockReasons: ["invalid_format", "missing_domain", "no_mx_or_dns"],
            },
            kpiTuning: loadKpiTuning(),
            deliverabilityGuard: loadDeliverabilityGuard(),
          },
          null,
          2
        )
      );
      return;
    }

    console.log(`Usage:
  node scripts/usa-gummies-agentic.mjs init
  node scripts/usa-gummies-agentic.mjs run-agent audit
  node scripts/usa-gummies-agentic.mjs run-agent agent1 [--target 40]
  node scripts/usa-gummies-agentic.mjs run-agent agent3 [--limit 35] [--dry-run]
  node scripts/usa-gummies-agentic.mjs run-agent agent8
  node scripts/usa-gummies-agentic.mjs run-agent agent9
  node scripts/usa-gummies-agentic.mjs run-agent agent11
  node scripts/usa-gummies-agentic.mjs run-agent agent12
  node scripts/usa-gummies-agentic.mjs run-agent agent22
  node scripts/usa-gummies-agentic.mjs run-agent agent13
  node scripts/usa-gummies-agentic.mjs run-agent agent18
  node scripts/usa-gummies-agentic.mjs run-agent agent19
  node scripts/usa-gummies-agentic.mjs run-agent agent20
  node scripts/usa-gummies-agentic.mjs run-agent agent21
  node scripts/usa-gummies-agentic.mjs run-agent agent16
  node scripts/usa-gummies-agentic.mjs run-agent agent17
  node scripts/usa-gummies-agentic.mjs run-agent agent10
  node scripts/usa-gummies-agentic.mjs run-agent agent23          # Deal Progression Tracker
  node scripts/usa-gummies-agentic.mjs run-agent agent24          # Pricing & Quote Generator
  node scripts/usa-gummies-agentic.mjs run-agent agent25          # Order Fulfillment Bridge
  node scripts/usa-gummies-agentic.mjs run-agent agent26          # Win/Loss Analyzer (weekly)
  node scripts/usa-gummies-agentic.mjs run-agent agent27 [--limit 5]  # Re-engagement Campaigner
  node scripts/usa-gummies-agentic.mjs run-agent agent28          # Faire Order Monitor
  node scripts/usa-gummies-agentic.mjs run-agent agent29          # Template A/B Rotator (weekly)
  node scripts/usa-gummies-agentic.mjs run-agent agent30 [--limit 20] # Contact Enrichment
  node scripts/usa-gummies-agentic.mjs run-daily [--dry-run]
  node scripts/usa-gummies-agentic.mjs run-research-backfill [--target 20] [--limit 6]
  node scripts/usa-gummies-agentic.mjs status
  node scripts/usa-gummies-agentic.mjs traction
  node scripts/usa-gummies-agentic.mjs params`);
  } catch (err) {
    const msg = String(err.message || err);
    log(`ERROR: ${msg}`);
    try {
      if (notionKey && dbSchemas[IDS.runLog]) {
        await logRun({
          agentName: "System",
          recordsProcessed: 0,
          emailsSent: 0,
          errors: msg,
          status: "Failed",
          notes: "Unhandled runtime exception.",
        });
      }
    } catch {
      // no-op
    }
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(String(err?.message || err));
    process.exit(1);
  });
