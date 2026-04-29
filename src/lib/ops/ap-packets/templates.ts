/**
 * AP Packet Template Registry — internal, no email, no QBO, no Drive.
 *
 * Why this exists
 * ---------------
 * Today's only live AP packet is `JUNGLE_JIMS_PACKET` in
 * `src/lib/ops/ap-packets.ts`. Onboarding the next retailer (Whole
 * Foods, Kroger, etc.) by hand-copying that record into a giant
 * literal is error-prone — easy to ship the wrong remit-to address or
 * miss a UPC. This module provides:
 *
 *   1. A canonical template (the USA-Gummies-side fields + catalog +
 *      reply-draft skeleton) that is stable across retailers.
 *   2. A typed `ApPacketDraft` shape that captures retailer-specific
 *      data the operator must fill in (account name, AP email, due
 *      window, etc.) plus a recomputed `missingRequired` list so the
 *      dashboard can show "incomplete" badges honestly.
 *   3. KV-backed draft storage (`ap-packets:drafts:<slug>`) so drafts
 *      survive across operator sessions and can be promoted to live
 *      packets later by a separate (future) flow.
 *
 * Hard rules this module enforces:
 *
 *   - No email, no QBO, no Gmail, no Drive writes happen here. The
 *     module is a pure type + KV-write boundary.
 *   - Drafts are intentionally NOT visible to `getApPacket()` (in
 *     `ap-packets.ts`), which is what `/api/ops/fulfillment/ap-packet/send`
 *     uses. So a draft cannot be sent — even if someone manually
 *     POSTs the slug to the send route, `getApPacket()` returns null
 *     and the route 404s before any approval check.
 *   - Operator must supply retailer-specific fields. The template
 *     never invents an AP email or remit-to for the retailer.
 *   - Required-field validation is deterministic. Any change to the
 *     required set is one constant edit + one test update.
 */

import { kv } from "@vercel/kv";

import type {
  ApPacket,
  ApPacketAttachment,
  ApPacketCatalogRow,
  ApPacketField,
} from "../ap-packets";

// ----- Template type -------------------------------------------------------

export interface ApPacketTemplate {
  slug: string;
  /** Operator-facing label shown next to the "Create from template" button. */
  label: string;
  /** What this template covers. Shown in the form description. */
  purpose: string;
  /** USA-Gummies-side company profile — never retailer-specific. */
  companyProfile: ApPacket["companyProfile"];
  /** USA-Gummies-side fieldMap — never retailer-specific. */
  fieldMap: ApPacketField[];
  /** Default attachment list — operator can edit per draft. */
  defaultAttachments: ApPacketAttachment[];
  /** Default catalog rows (our products). */
  defaultCatalog: ApPacketCatalogRow[];
  /** Reply body skeleton with `{{retailer}}` placeholder. */
  replyDraftSkeleton: { subjectTemplate: string; bodyTemplate: string };
  /** Default next-actions phrased generically. */
  defaultNextActions: string[];
  /** Stable doctrine-source list. */
  sources: string[];
}

// ----- Draft type ----------------------------------------------------------

export interface ApPacketDraftInput {
  /** Stable URL-safe identifier for the new packet (e.g. `whole-foods`). */
  slug: string;
  /** Template to clone from. Use `listApPacketTemplates()` for valid slugs. */
  templateSlug: string;
  /** Retailer name as it should appear in the packet header. */
  accountName: string;
  /** Retailer AP email — required for any future send. */
  apEmail: string;
  /** Owner — Rene by default, but an operator override is allowed. */
  owner?: string;
  /** Due window phrasing for the dashboard. */
  dueWindow?: string;
  /** Free-text note about why this packet was opened. Stored on the draft only. */
  note?: string;
}

export interface ApPacketDraft {
  slug: string;
  templateSlug: string;
  /** Constant `"draft"` so list consumers can filter by lifecycle. */
  lifecycle: "draft";
  accountName: string;
  apEmail: string;
  owner: string;
  dueWindow: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  /** True only when every required field + attachment is populated. */
  requiredFieldsComplete: boolean;
  /** Human-readable list of what's still missing. Empty when complete. */
  missingRequired: string[];
  /** Snapshot of the company profile from the template at creation time. */
  companyProfile: ApPacket["companyProfile"];
  /** Snapshot of the catalog at creation time. */
  catalog: ApPacketCatalogRow[];
  /** Cloned attachments — operator updates statuses as docs land. */
  attachments: ApPacketAttachment[];
  /** Reply draft with `{{retailer}}` substituted. */
  replyDraft: { subject: string; body: string };
  /** Per-template next-actions, phrased for this retailer. */
  nextActions: string[];
}

// ----- Errors --------------------------------------------------------------

export class TemplateNotFoundError extends Error {
  constructor(slug: string) {
    super(`AP packet template "${slug}" not found`);
    this.name = "TemplateNotFoundError";
  }
}

export class DraftValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Draft validation failed: ${issues.join("; ")}`);
    this.name = "DraftValidationError";
  }
}

// ----- The base template ---------------------------------------------------

/**
 * Single canonical template for retailer/AP onboarding packets.
 *
 * Company-side fields are pulled from the existing JUNGLE_JIMS_PACKET
 * — they are USA Gummies entity data that doesn't change per retailer.
 * Retailer-specific fields are NOT included here; the operator must
 * supply them via `createApPacketDraft()`.
 */
export const USA_GUMMIES_BASE_TEMPLATE: ApPacketTemplate = {
  slug: "usa-gummies-base",
  label: "USA Gummies — base AP onboarding packet",
  purpose:
    "Standard retailer/AP onboarding response. Includes our W-9, CIF-001, item list/catalog, and remit-to/ACH details. Operator supplies retailer name, AP email, and due window.",
  companyProfile: {
    legalCompanyName: "USA Gummies, LLC",
    dba: "USA Gummies",
    ein: "33-4744824",
    remitToAddress: "1309 Coffeen Ave, Ste 1200, Sheridan, WY 82801-5777",
    website: "www.usagummies.com",
    companyPhone: "(307) 209-4928",
    apEmail: "ben@usagummies.com",
    salesEmail: "ben@usagummies.com",
    paymentTerms: "Due on Receipt / Net 10 (per invoice)",
    paymentMethods: "ACH, wire",
    poRequirement: "PO number required on all invoices",
    achRouting: "125000024",
    wireRouting: "026009593",
    bankName: "Bank of America",
    accountName: "Business Adv Fundamentals",
  },
  fieldMap: [
    { label: "Legal company name", value: "USA Gummies, LLC" },
    { label: "DBA / trade name", value: "USA Gummies" },
    { label: "Federal tax ID", value: "33-4744824" },
    {
      label: "Remit-to address",
      value: "1309 Coffeen Ave, Ste 1200, Sheridan, WY 82801-5777",
    },
    { label: "Primary AP / AR email", value: "ben@usagummies.com" },
    { label: "Primary phone", value: "(307) 209-4928" },
    { label: "Website", value: "www.usagummies.com" },
    { label: "Payment terms", value: "Due on Receipt / Net 10" },
    { label: "Accepted payment methods", value: "ACH, wire" },
    { label: "PO required", value: "Yes — on all invoices" },
    { label: "ACH notification email", value: "ben@usagummies.com" },
    { label: "Bank name", value: "Bank of America" },
    { label: "ACH / paper routing", value: "125000024" },
    { label: "Wire routing", value: "026009593" },
    { label: "Bank account name", value: "Business Adv Fundamentals" },
  ],
  defaultAttachments: [
    {
      id: "vendor-setup-form",
      label: "Retailer-supplied Vendor Setup Form",
      status: "missing",
      note: "Operator uploads after the retailer sends their form. Required.",
    },
    {
      id: "w9",
      label: "Signed W-9",
      status: "ready",
      note: "USA Gummies W-9 staged in Drive — same file used across retailers.",
      driveUrl:
        "https://drive.google.com/file/d/1E0ITe1moy55eZA24y9ToIWNvH5oDQZgL/view?usp=drive_link",
    },
    {
      id: "cif",
      label: "CIF-001 Customer Information Form",
      status: "ready",
      note: "Standard CIF with remit-to + ACH + invoice requirements.",
      driveUrl:
        "https://drive.google.com/file/d/1NJcP4y1-znc1iKxXfEkrC1C2sLm2gGrw/view?usp=drive_link",
    },
    {
      id: "item-list",
      label: "Retailer AP item list / catalog",
      status: "review",
      note: "Generated from current verified product + UPC data. Confirm hyphenation / format with the retailer's import spec before send.",
    },
    {
      id: "sell-sheet",
      label: "Distributor sell sheet",
      status: "optional",
      note: "Useful backup product spec. Attach if the retailer's setup form references it.",
      driveUrl:
        "https://drive.google.com/file/d/1RXO5VHQHKt6Aq2KqJ8dcnfzk8yr6fcUf/view?usp=drive_link",
    },
    {
      id: "ach-form",
      label: "ACH enrollment form",
      status: "optional",
      note: "Only attach if the retailer wants ACH activated and has supplied their bank-support requirement.",
    },
  ],
  defaultCatalog: [
    {
      vendorItemNumber: "AAGB-7.5",
      description:
        "All American Gummy Bears — Natural Colors, No Artificial Dyes, Made in USA",
      size: "7.5 oz (213g)",
      unitUpc: "1-99284-62470-2",
      caseUpc: "1-99284-71553-0",
      masterCartonUpc: "1-99284-37324-2",
      casePack: 6,
      caseCost: 20.94,
      unitWholesalePrice: 3.49,
      srpRange: "$4.99-$6.49",
      minOrder: "1 master carton (36 bags / 6 cases)",
      shelfLife: "18 months",
      sourceNote:
        "Case cost set 2026-04-23. Hyphenated UPC pattern is the most common retailer import format; some retailers strip hyphens.",
    },
  ],
  replyDraftSkeleton: {
    subjectTemplate: "Re: {{retailer}} New Account Setup Forms",
    bodyTemplate: [
      "Hi {{retailer}} Accounting Team,",
      "",
      "Thank you for sending the new account setup forms.",
      "",
      "Attached are our completed Vendor and Contractor Setup / Update Form, our signed W-9, our customer information form, and our item list / catalog for All American Gummy Bears.",
      "",
      "For reference, our current item setup details are:",
      "- Vendor item number: AAGB-7.5",
      "- Description: All American Gummy Bears",
      "- Size: 7.5 oz (213g)",
      "- UPC / EAN: 1-99284-62470-2",
      "- Case pack: 6",
      "- Current quoted case cost: $20.94",
      "",
      "If you would like ACH activated now as well, let us know and we can send the ACH enrollment page with any supporting bank document you require.",
      "",
      "Best,",
      "Ben Stutman",
      "USA Gummies",
      "ben@usagummies.com",
      "(307) 209-4928",
    ].join("\n"),
  },
  defaultNextActions: [
    "Confirm the retailer's preferred UPC / EAN hyphenation pattern matches the catalog.",
    "Receive and stage the retailer's completed Vendor Setup Form before send.",
    "Verify pricing (case cost / unit wholesale) against the retailer's most recent ask.",
    "Only attach ACH enrollment if the retailer has confirmed they want ACH activated now.",
  ],
  sources: [
    "Drive: CIF-001 Customer Information Form",
    "Drive: USA Gummies W-9 2026",
    "Drive: Distributor Sell Sheet v3",
    "Slack #financials: Rene finance doctrine (canonical)",
  ],
};

const TEMPLATES: readonly ApPacketTemplate[] = [USA_GUMMIES_BASE_TEMPLATE];

export function listApPacketTemplates(): ApPacketTemplate[] {
  return [...TEMPLATES];
}

export function getApPacketTemplate(slug: string): ApPacketTemplate | null {
  return TEMPLATES.find((t) => t.slug === slug) ?? null;
}

// ----- Validation ---------------------------------------------------------

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,40}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateInput(input: ApPacketDraftInput): string[] {
  const issues: string[] = [];
  if (!input.slug || !SLUG_RE.test(input.slug)) {
    issues.push(
      "slug required (kebab-case, 2-42 chars, must start + end with alphanumeric)",
    );
  }
  if (!input.templateSlug) {
    issues.push("templateSlug required");
  }
  if (!input.accountName || input.accountName.trim().length === 0) {
    issues.push("accountName required (retailer name as it should appear)");
  }
  if (!input.apEmail || !EMAIL_RE.test(input.apEmail)) {
    issues.push("apEmail required (valid email)");
  }
  return issues;
}

/**
 * Recompute which required fields/attachments are still missing.
 * Pure — caller passes the in-progress draft, gets back the updated
 * `requiredFieldsComplete` + `missingRequired` list.
 */
export function evaluateDraftCompleteness(
  draft: Pick<
    ApPacketDraft,
    "accountName" | "apEmail" | "owner" | "dueWindow" | "attachments"
  >,
): { requiredFieldsComplete: boolean; missingRequired: string[] } {
  const missing: string[] = [];
  if (!draft.accountName?.trim()) missing.push("accountName");
  if (!draft.apEmail?.trim() || !EMAIL_RE.test(draft.apEmail)) {
    missing.push("apEmail");
  }
  if (!draft.owner?.trim()) missing.push("owner");
  if (!draft.dueWindow?.trim()) missing.push("dueWindow");

  // Required attachment statuses must be 'ready' OR 'review' (review
  // is OK to send-with-warning). 'missing' blocks completion.
  for (const att of draft.attachments ?? []) {
    if (att.status === "missing") {
      missing.push(`attachment:${att.id}`);
    }
  }

  return {
    requiredFieldsComplete: missing.length === 0,
    missingRequired: missing,
  };
}

// ----- Template → Draft factory -------------------------------------------

/**
 * Pure factory: build a draft from a template + operator input.
 *
 * Throws DraftValidationError when input is invalid (missing slug,
 * malformed email, etc.). Does NOT touch KV — caller decides whether
 * to persist via `writeApPacketDraft()`.
 */
export function buildApPacketDraft(
  input: ApPacketDraftInput,
  now: Date = new Date(),
): ApPacketDraft {
  const inputIssues = validateInput(input);
  if (inputIssues.length > 0) {
    throw new DraftValidationError(inputIssues);
  }
  const template = getApPacketTemplate(input.templateSlug);
  if (!template) {
    throw new TemplateNotFoundError(input.templateSlug);
  }

  const accountName = input.accountName.trim();
  const apEmail = input.apEmail.trim().toLowerCase();
  const owner = (input.owner ?? "Rene Gonzalez").trim();
  const dueWindow = (input.dueWindow ?? "Return packet within 5 business days").trim();
  const note = input.note?.trim() || null;
  const createdAt = now.toISOString();

  const attachments = template.defaultAttachments.map((a) => ({ ...a }));
  const replyDraft = {
    subject: substitute(template.replyDraftSkeleton.subjectTemplate, accountName),
    body: substitute(template.replyDraftSkeleton.bodyTemplate, accountName),
  };

  const draft: ApPacketDraft = {
    slug: input.slug,
    templateSlug: template.slug,
    lifecycle: "draft",
    accountName,
    apEmail,
    owner,
    dueWindow,
    note,
    createdAt,
    updatedAt: createdAt,
    requiredFieldsComplete: false,
    missingRequired: [],
    companyProfile: { ...template.companyProfile },
    catalog: template.defaultCatalog.map((c) => ({ ...c })),
    attachments,
    replyDraft,
    nextActions: [...template.defaultNextActions],
  };

  const evaluation = evaluateDraftCompleteness(draft);
  draft.requiredFieldsComplete = evaluation.requiredFieldsComplete;
  draft.missingRequired = evaluation.missingRequired;
  return draft;
}

function substitute(template: string, retailer: string): string {
  return template.replaceAll("{{retailer}}", retailer);
}

// ----- KV draft store -----------------------------------------------------

const KV_DRAFT_PREFIX = "ap-packets:drafts:";
const KV_DRAFT_INDEX = "ap-packets:drafts:_index";

function draftKey(slug: string): string {
  return `${KV_DRAFT_PREFIX}${slug}`;
}

async function readIndex(): Promise<string[]> {
  try {
    const raw = await kv.get<string[]>(KV_DRAFT_INDEX);
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function writeIndex(slugs: string[]): Promise<void> {
  try {
    // Dedup + cap to a sensible upper bound so the index doesn't grow forever.
    const unique = Array.from(new Set(slugs)).slice(-500);
    await kv.set(KV_DRAFT_INDEX, unique);
  } catch {
    /* fail-soft */
  }
}

/**
 * Persist a draft to KV. Idempotent — same slug overwrites. Returns
 * the persisted draft so the caller can echo it back to the operator.
 */
export async function writeApPacketDraft(
  draft: ApPacketDraft,
): Promise<ApPacketDraft> {
  const final = { ...draft, updatedAt: new Date().toISOString() };
  await kv.set(draftKey(final.slug), JSON.stringify(final));
  const index = await readIndex();
  if (!index.includes(final.slug)) {
    await writeIndex([...index, final.slug]);
  }
  return final;
}

export async function getApPacketDraft(
  slug: string,
): Promise<ApPacketDraft | null> {
  try {
    const raw = await kv.get<string | ApPacketDraft>(draftKey(slug));
    if (!raw) return null;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) as ApPacketDraft;
      } catch {
        return null;
      }
    }
    return raw as ApPacketDraft;
  } catch {
    return null;
  }
}

export async function listApPacketDrafts(): Promise<ApPacketDraft[]> {
  const index = await readIndex();
  if (index.length === 0) return [];
  const drafts: ApPacketDraft[] = [];
  for (const slug of index) {
    const d = await getApPacketDraft(slug);
    if (d) drafts.push(d);
  }
  // Newest first.
  return drafts.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * High-level convenience: validate input, build the draft, persist to
 * KV, return the final draft. The single entry point for the dashboard
 * "Create from template" form. Never sends email / writes QBO / writes
 * Drive.
 */
export async function createApPacketDraft(
  input: ApPacketDraftInput,
): Promise<ApPacketDraft> {
  const draft = buildApPacketDraft(input);
  return writeApPacketDraft(draft);
}
