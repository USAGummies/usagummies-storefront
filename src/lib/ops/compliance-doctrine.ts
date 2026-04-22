/**
 * Compliance Doctrine — known recurring obligations for USA Gummies.
 *
 * USED ONLY WHEN the Notion `/Legal/Compliance Calendar` database is
 * missing. Surfaces the CATEGORIES of obligations Ben + counsel
 * should track — with NO specific dates fabricated. Every entry asks
 * Ben to verify the real date with his filings.
 *
 * Each row is explicitly tagged `[FALLBACK]` in the rendered output
 * so readers know this is doctrine-sourced, not calendar-authoritative.
 * Governance §1.6 no-fabrication is preserved — we list topics, not
 * invented dates.
 *
 * Source material:
 *   - Wyoming C-Corp annual requirements (Wyoming Attorneys LLC)
 *   - USPTO trademark maintenance schedule (§8 / §9 / §15)
 *   - FDA Food Facility Registration biennial renewal
 *   - WA state business license (warehouse operating state)
 *   - Standard small-business insurance renewal cadence
 *
 * When the Notion DB ships, delete this module OR keep it as a
 * `[DOUBLE-CHECK]` overlay that warns if Notion is missing any of
 * these categories.
 */

export type ComplianceCategory =
  | "corporate"
  | "tax"
  | "trademark"
  | "fda"
  | "insurance"
  | "license"
  | "contracts";

export type ComplianceCadence =
  | "annual"
  | "biennial"
  | "quarterly"
  | "one-time"
  | "variable";

export interface DoctrineObligation {
  id: string;
  category: ComplianceCategory;
  cadence: ComplianceCadence;
  /** Human-readable title. */
  title: string;
  /** What triggers the deadline (e.g. "anniversary of incorporation"). */
  trigger: string;
  /** What Ben has to actually do. */
  action: string;
  /** Who holds the authoritative date (vendor, agent, registrar). */
  dateSource: string;
  /** Who can miss this at USA Gummies. */
  owner: "Ben" | "Rene" | "Drew" | "Counsel";
  /** Typical penalty/risk if missed. */
  penaltyIfMissed: string;
  /** Link to the governing statute or vendor portal when helpful. */
  reference?: string;
}

export const COMPLIANCE_DOCTRINE: DoctrineObligation[] = [
  // ---- Corporate ----
  {
    id: "wy-annual-report",
    category: "corporate",
    cadence: "annual",
    title: "Wyoming Secretary of State Annual Report",
    trigger: "First day of the month of incorporation anniversary",
    action:
      "File Annual Report via WY SOS or Wyoming Attorneys LLC (registered agent). $62 minimum.",
    dateSource: "Wyoming Attorneys LLC — ask for the exact due date",
    owner: "Ben",
    penaltyIfMissed: "WY corporate charter revocation within ~90 days of miss",
    reference: "https://wyobiz.wyo.gov/Business/FilingSearch.aspx",
  },
  {
    id: "wy-registered-agent-renewal",
    category: "corporate",
    cadence: "annual",
    title: "Wyoming Registered Agent renewal",
    trigger: "Anniversary of agent engagement (Wyoming Attorneys LLC)",
    action: "Pay Wyoming Attorneys LLC annual fee (~$200).",
    dateSource: "Wyoming Attorneys LLC invoice",
    owner: "Ben",
    penaltyIfMissed:
      "Agent resigns → WY SOS flags corporate as delinquent → charter jeopardy",
  },

  // ---- Tax ----
  {
    id: "federal-1120",
    category: "tax",
    cadence: "annual",
    title: "Federal 1120 (C-Corp income tax)",
    trigger: "March 15 of each year (Q1 after fiscal year end if Dec 31 FY)",
    action: "Rene + CPA file Form 1120 with IRS; pay any balance due.",
    dateSource: "IRS — March 15 hard-coded (6-month extension available)",
    owner: "Rene",
    penaltyIfMissed:
      "IRS penalty 5% per month up to 25% of unpaid tax + interest",
  },
  {
    id: "wa-business-personal-property-tax",
    category: "tax",
    cadence: "annual",
    title: "WA Personal Property Tax (warehouse inventory)",
    trigger: "WA state deadline varies by county (~April 30)",
    action:
      "Rene files Pierce County Assessor personal-property return for the Ashford warehouse inventory.",
    dateSource: "Pierce County Assessor — verify exact deadline",
    owner: "Rene",
    penaltyIfMissed: "WA state penalty 5-25% of tax due",
  },

  // ---- Trademark ----
  {
    id: "uspto-section-8",
    category: "trademark",
    cadence: "variable",
    title: "USPTO §8 Declaration of Continued Use",
    trigger:
      "Between 5th and 6th anniversary of registration date (6-month grace period after)",
    action:
      "File Declaration of Continued Use + specimen showing current use of USA Gummies mark.",
    dateSource: "USPTO TSDR for registration # — or USA Gummies trademark file",
    owner: "Counsel",
    penaltyIfMissed:
      "Trademark registration canceled — loss of federal rights",
    reference: "https://www.uspto.gov/trademarks/maintain",
  },
  {
    id: "uspto-section-9",
    category: "trademark",
    cadence: "variable",
    title: "USPTO §9 Renewal + §8 Declaration",
    trigger:
      "Between 9th and 10th anniversary of registration, then every 10 years",
    action: "File combined §8 + §9 renewal with USPTO.",
    dateSource: "USPTO TSDR — due date auto-calculable from registration",
    owner: "Counsel",
    penaltyIfMissed:
      "Trademark registration canceled — loss of federal rights",
  },

  // ---- FDA ----
  {
    id: "fda-food-facility-registration",
    category: "fda",
    cadence: "biennial",
    title: "FDA Food Facility Registration (FFR) biennial renewal",
    trigger: "Oct 1 – Dec 31 of every even-numbered year",
    action:
      "Renew FFR via https://www.access.fda.gov/oaa/ — both the Ashford warehouse AND the Powers co-packer facility on our registration.",
    dateSource: "FDA FFR portal for facility FEI #",
    owner: "Drew",
    penaltyIfMissed:
      "Registration canceled → FDA issues Import Alert; product can't enter commerce",
    reference: "https://www.fda.gov/food/online-registration-food-facilities",
  },

  // ---- Insurance ----
  {
    id: "general-liability-insurance",
    category: "insurance",
    cadence: "annual",
    title: "General Liability insurance renewal (+ product liability)",
    trigger: "Policy anniversary date (varies by carrier)",
    action:
      "Confirm renewal terms, review exclusions for confectionery/food products, pay premium.",
    dateSource: "Insurance broker (insurance-carrier policy docs)",
    owner: "Ben",
    penaltyIfMissed:
      "Lapse in coverage — any incident during lapse is uninsured; retailers require active COI on file",
  },
  {
    id: "workers-comp-wa",
    category: "insurance",
    cadence: "quarterly",
    title: "WA Workers' Comp (L&I) quarterly report",
    trigger: "Q1/Q2/Q3/Q4 ends (Apr 30 / Jul 31 / Oct 31 / Jan 31)",
    action:
      "Rene files L&I quarterly report + pays premium based on hours worked.",
    dateSource: "WA L&I portal",
    owner: "Rene",
    penaltyIfMissed:
      "WA L&I penalty + interest; cannot legally employ workers in WA",
  },

  // ---- Licenses ----
  {
    id: "wa-business-license",
    category: "license",
    cadence: "annual",
    title: "WA State Business License renewal",
    trigger: "Anniversary of license issuance",
    action:
      "Renew via WA DOR Business Licensing Service. $19 + trade-name fees.",
    dateSource: "WA DOR BLS portal",
    owner: "Ben",
    penaltyIfMissed: "License expired → can't legally conduct WA business",
    reference: "https://dor.wa.gov/",
  },

  // ---- Contracts ----
  {
    id: "vendor-coi-powers",
    category: "contracts",
    cadence: "annual",
    title: "Powers Confections Certificate of Insurance on file",
    trigger: "Powers' COI effective date rollover (typically annual)",
    action:
      "Request updated COI from Powers each renewal; store in /Legal/Vendor Insurance Notion folder.",
    dateSource: "Powers Confections insurance broker",
    owner: "Drew",
    penaltyIfMissed:
      "Retailer audits without current COI → product pull; contract-breach exposure",
  },
  {
    id: "vendor-coi-belmark",
    category: "contracts",
    cadence: "annual",
    title: "Belmark Packaging Certificate of Insurance on file",
    trigger: "Belmark's COI effective date rollover (typically annual)",
    action:
      "Request updated COI from Belmark each renewal; store in /Legal/Vendor Insurance Notion folder.",
    dateSource: "Belmark Insurance broker",
    owner: "Drew",
    penaltyIfMissed:
      "Supply-chain contract breach exposure in any claim involving packaging",
  },
];

/**
 * Render the doctrine list as a Slack-flavored markdown digest.
 * Clearly tagged `[FALLBACK]` — the reader knows this is NOT the
 * live Notion calendar.
 */
export function renderComplianceDoctrineFallback(reason: string): string {
  const lines: string[] = [
    `:scales: *Compliance Specialist — DEGRADED (live calendar missing)*`,
    `_Reason: ${reason}_`,
    "",
    "*[FALLBACK doctrine list — not authoritative, verify real dates]*",
    "The specialist can't read the canonical `/Legal/Compliance Calendar`",
    "Notion database yet. Until Ben + counsel draft it (Canon §10.1 Lane E.1),",
    "here are the obligation categories Ben SHOULD track. Every row has a",
    "`dateSource` — pull the real date from there.",
    "",
  ];

  const byCategory = COMPLIANCE_DOCTRINE.reduce<
    Record<ComplianceCategory, DoctrineObligation[]>
  >(
    (acc, o) => {
      acc[o.category] = acc[o.category] ?? [];
      acc[o.category].push(o);
      return acc;
    },
    {} as Record<ComplianceCategory, DoctrineObligation[]>,
  );

  const categoryLabel: Record<ComplianceCategory, string> = {
    corporate: "Corporate (WY)",
    tax: "Tax (Federal + WA)",
    trademark: "Trademark (USPTO)",
    fda: "FDA",
    insurance: "Insurance",
    license: "Licenses",
    contracts: "Vendor contracts / COIs",
  };

  for (const [cat, rows] of Object.entries(byCategory)) {
    lines.push(`*${categoryLabel[cat as ComplianceCategory]}:*`);
    for (const r of rows) {
      lines.push(
        `  • [FALLBACK] *${r.title}* — ${r.cadence}, ${r.owner} owns. ${r.action}`,
      );
      lines.push(`      Trigger: ${r.trigger}. Date source: \`${r.dateSource}\``);
    }
    lines.push("");
  }

  lines.push(
    "_Blueprint §10.1 E.1 asks Ben + counsel to populate the live Notion database before the next Monday cutover gate. The specialist flips to live-mode automatically the first time the DB has rows._",
  );
  return lines.join("\n");
}
