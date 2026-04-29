export interface WholesaleProspectRow {
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  category: string;
  whyTarget: string;
  priority: string;
}

export type ProspectContactMode =
  | "email_ready"
  | "range_me"
  | "phone_only"
  | "research_needed";

export interface WholesaleProspect extends WholesaleProspectRow {
  rowNumber: number;
  contactMode: ProspectContactMode;
  displayName: string;
}

export interface ProspectPlaybookSummary {
  total: number;
  priorityCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  contactModeCounts: Record<ProspectContactMode, number>;
  emailReady: number;
  needsManualResearch: number;
}

export interface ProspectPlaybookReport {
  generatedAt: string;
  source: string;
  summary: ProspectPlaybookSummary;
  prospects: WholesaleProspect[];
}

const HEADERS = [
  "firstName",
  "lastName",
  "title",
  "company",
  "email",
  "phone",
  "city",
  "state",
  "category",
  "why_target",
  "priority",
] as const;

const MODE_ZERO: Record<ProspectContactMode, number> = {
  email_ready: 0,
  range_me: 0,
  phone_only: 0,
  research_needed: 0,
};

export function parseWholesaleProspectCsv(csv: string): WholesaleProspect[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const matches = HEADERS.every((expected, i) => header[i] === expected);
  if (!matches) {
    throw new Error("Unexpected wholesale prospect CSV header.");
  }

  return rows
    .slice(1)
    .map((cells, index) => normalizeProspectRow(cells, index + 2))
    .filter((row): row is WholesaleProspect => row !== null);
}

export function buildProspectPlaybookReport(
  csv: string,
  options: { generatedAt: string; source: string },
): ProspectPlaybookReport {
  const prospects = parseWholesaleProspectCsv(csv);
  return {
    generatedAt: options.generatedAt,
    source: options.source,
    prospects,
    summary: summarizeProspects(prospects),
  };
}

export function summarizeProspects(
  prospects: readonly WholesaleProspect[],
): ProspectPlaybookSummary {
  const priorityCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const contactModeCounts = { ...MODE_ZERO };

  for (const prospect of prospects) {
    const priority = prospect.priority || "unknown";
    const category = prospect.category || "unknown";
    priorityCounts[priority] = (priorityCounts[priority] ?? 0) + 1;
    categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
    contactModeCounts[prospect.contactMode] += 1;
  }

  return {
    total: prospects.length,
    priorityCounts,
    categoryCounts,
    contactModeCounts,
    emailReady: contactModeCounts.email_ready,
    needsManualResearch:
      contactModeCounts.range_me +
      contactModeCounts.phone_only +
      contactModeCounts.research_needed,
  };
}

function normalizeProspectRow(
  cells: readonly string[],
  rowNumber: number,
): WholesaleProspect | null {
  const [
    firstName = "",
    lastName = "",
    title = "",
    company = "",
    email = "",
    phone = "",
    city = "",
    state = "",
    category = "",
    whyTarget = "",
    priority = "",
  ] = cells.map((cell) => cell.trim());

  if (!company) return null;

  const contactMode = classifyContactMode({ email, phone, whyTarget, title });
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  return {
    rowNumber,
    firstName,
    lastName,
    title,
    company,
    email,
    phone,
    city,
    state,
    category,
    whyTarget,
    priority,
    contactMode,
    displayName: fullName || title || "Buyer",
  };
}

function classifyContactMode(input: {
  email: string;
  phone: string;
  whyTarget: string;
  title: string;
}): ProspectContactMode {
  if (isValidEmail(input.email)) return "email_ready";
  if (/\brangeme\b/i.test(`${input.whyTarget} ${input.title}`)) return "range_me";
  if (input.phone.trim()) return "phone_only";
  return "research_needed";
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < csv.length; i += 1) {
    const ch = csv[i];
    const next = csv[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }

  row.push(field);
  if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
  return rows;
}
