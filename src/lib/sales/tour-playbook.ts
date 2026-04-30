export type SalesTourGroup =
  | "route_segment"
  | "vicinity_tier1"
  | "vicinity_tier2"
  | "supplemental";

export type SalesTourContactStatus =
  | "verified_email"
  | "generic_email"
  | "sent"
  | "phone_or_call"
  | "research_needed"
  | "closed_or_customer"
  | "gap";

export type SalesTourPrioritySignal =
  | "hot"
  | "warm"
  | "closed"
  | "new"
  | "cold"
  | "deprioritized"
  | "unknown";

export interface SalesTourProspect {
  id: string;
  group: SalesTourGroup;
  section: string;
  prospect: string;
  type: string;
  contact: string;
  email: string;
  action: string;
  phone: string;
  notes: string;
  contactStatus: SalesTourContactStatus;
  prioritySignal: SalesTourPrioritySignal;
}

export interface SalesTourSection {
  group: SalesTourGroup;
  title: string;
  count: number;
}

export interface SalesTourSummary {
  total: number;
  routeSegmentRows: number;
  vicinityRows: number;
  verifiedEmails: number;
  genericEmails: number;
  alreadySent: number;
  researchNeeded: number;
  callTasks: number;
  warmOrHot: number;
  closedOrCustomer: number;
  gapsSkipped: number;
}

export interface SalesTourPlaybookReport {
  generatedAt: string;
  source: string;
  summary: SalesTourSummary;
  sections: SalesTourSection[];
  prospects: SalesTourProspect[];
}

interface ActiveTable {
  group: SalesTourGroup;
  section: string;
  headers: string[];
}

const ZERO_SUMMARY: SalesTourSummary = {
  total: 0,
  routeSegmentRows: 0,
  vicinityRows: 0,
  verifiedEmails: 0,
  genericEmails: 0,
  alreadySent: 0,
  researchNeeded: 0,
  callTasks: 0,
  warmOrHot: 0,
  closedOrCustomer: 0,
  gapsSkipped: 0,
};

export function buildSalesTourPlaybookReport(
  markdown: string,
  options: { generatedAt: string; source: string },
): SalesTourPlaybookReport {
  const { prospects, gapsSkipped } = parseSalesTourMarkdown(markdown);
  return {
    generatedAt: options.generatedAt,
    source: options.source,
    prospects,
    sections: summarizeSections(prospects),
    summary: summarizeSalesTourProspects(prospects, gapsSkipped),
  };
}

export function parseSalesTourMarkdown(markdown: string): {
  prospects: SalesTourProspect[];
  gapsSkipped: number;
} {
  const prospects: SalesTourProspect[] = [];
  let currentHeading = "";
  let active: ActiveTable | null = null;
  let gapsSkipped = 0;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("### ")) {
      currentHeading = cleanMarkdown(line.replace(/^###\s+/, ""));
      active = null;
      continue;
    }

    if (!line.startsWith("|")) {
      active = null;
      continue;
    }

    const cells = splitMarkdownTableRow(line);
    if (cells.length < 3 || isSeparatorRow(cells)) continue;

    if (isHeaderRow(cells)) {
      const group = classifyHeading(currentHeading);
      active = group
        ? {
            group,
            section: currentHeading,
            headers: cells.map((cell) => normalizeHeader(cell)),
          }
        : null;
      continue;
    }

    if (!active) continue;

    const prospect = normalizeProspectRow(cells, active, prospects.length);
    if (prospect === "gap") {
      gapsSkipped += 1;
      continue;
    }
    if (prospect) prospects.push(prospect);
  }

  return { prospects, gapsSkipped };
}

export function summarizeSalesTourProspects(
  prospects: readonly SalesTourProspect[],
  gapsSkipped = 0,
): SalesTourSummary {
  const summary = { ...ZERO_SUMMARY, total: prospects.length, gapsSkipped };
  for (const prospect of prospects) {
    if (prospect.group === "route_segment") summary.routeSegmentRows += 1;
    else summary.vicinityRows += 1;

    if (prospect.contactStatus === "verified_email") summary.verifiedEmails += 1;
    if (prospect.contactStatus === "generic_email") summary.genericEmails += 1;
    if (prospect.contactStatus === "sent") summary.alreadySent += 1;
    if (prospect.contactStatus === "research_needed") summary.researchNeeded += 1;
    if (prospect.contactStatus === "phone_or_call") summary.callTasks += 1;
    if (prospect.contactStatus === "closed_or_customer") summary.closedOrCustomer += 1;
    if (prospect.prioritySignal === "warm" || prospect.prioritySignal === "hot") {
      summary.warmOrHot += 1;
    }
  }
  return summary;
}

function summarizeSections(
  prospects: readonly SalesTourProspect[],
): SalesTourSection[] {
  const map = new Map<string, SalesTourSection>();
  for (const prospect of prospects) {
    const key = `${prospect.group}:${prospect.section}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(key, {
        group: prospect.group,
        title: prospect.section,
        count: 1,
      });
    }
  }
  return Array.from(map.values());
}

function classifyHeading(heading: string): SalesTourGroup | null {
  if (/Segment\s+\d+/i.test(heading)) return "route_segment";
  if (/Tier\s+1/i.test(heading)) return "vicinity_tier1";
  if (/Tier\s+2/i.test(heading)) return "vicinity_tier2";
  if (/Supplemental routing stops/i.test(heading)) return "supplemental";
  return null;
}

function normalizeProspectRow(
  cells: readonly string[],
  table: ActiveTable,
  index: number,
): SalesTourProspect | "gap" | null {
  const byHeader = new Map<string, string>();
  table.headers.forEach((header, i) => {
    byHeader.set(header, cleanMarkdown(cells[i] ?? ""));
  });

  const prospect = firstValue(byHeader, ["prospect", "venue"]);
  if (!prospect) return null;
  if (/\bgap to be researched\b/i.test(prospect)) return "gap";

  const type = firstValue(byHeader, ["type"]) || "";
  const contact =
    firstValue(byHeader, ["hubspot contact", "buyer", "contact path"]) || "";
  const email = firstValue(byHeader, ["verified email", "email"]) || "";
  const action = firstValue(byHeader, ["action", "sent"]) || "";
  const phone = firstValue(byHeader, ["phone"]) || "";
  const notes = firstValue(byHeader, ["notes"]) || "";
  const haystack = [prospect, type, contact, email, action, phone, notes].join(" ");

  return {
    id: `${table.group}-${index + 1}-${slugify(prospect)}`,
    group: table.group,
    section: table.section,
    prospect,
    type,
    contact,
    email,
    action,
    phone,
    notes,
    contactStatus: classifyContactStatus({ email, action, contact, phone, haystack }),
    prioritySignal: classifyPrioritySignal(haystack),
  };
}

function classifyContactStatus(input: {
  email: string;
  action: string;
  contact: string;
  phone: string;
  haystack: string;
}): SalesTourContactStatus {
  const text = input.haystack;
  if (/\b(closed|existing customer)\b/i.test(text)) return "closed_or_customer";
  if (/(^|\s)✅|\bsent\b/i.test(input.action)) return "sent";
  const email = extractEmail(`${input.email} ${input.contact} ${input.action}`);
  if (email) {
    return isGenericEmail(email) ? "generic_email" : "verified_email";
  }
  if (/\b(call task|phone-first|phone\b|☎)/i.test(text) || input.phone.trim()) {
    return "phone_or_call";
  }
  if (/\b(TBD|research|verify|bounced|no named buyer|❌)\b/i.test(text)) {
    return "research_needed";
  }
  return "research_needed";
}

function classifyPrioritySignal(text: string): SalesTourPrioritySignal {
  if (/\b(deprioritize|deprioritized|skip)\b/i.test(text)) return "deprioritized";
  if (/\b(closed|existing customer)\b/i.test(text)) return "closed";
  if (/🔥|highest priority|wants to order/i.test(text)) return "hot";
  if (/\b(Reunion warm|warm)\b/i.test(text)) return "warm";
  if (/\bNEW\b|NEW —/i.test(text)) return "new";
  if (/\bCold\b/i.test(text)) return "cold";
  return "unknown";
}

function firstValue(map: ReadonlyMap<string, string>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = map.get(key);
    if (value) return value;
  }
  return "";
}

function splitMarkdownTableRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isHeaderRow(cells: readonly string[]): boolean {
  const normalized = cells.map((cell) => normalizeHeader(cell));
  return normalized.includes("prospect") || normalized.includes("venue");
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function normalizeHeader(value: string): string {
  return cleanMarkdown(value).toLowerCase();
}

function cleanMarkdown(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEmail(value: string): string | null {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

function isGenericEmail(email: string): boolean {
  return /^(info|contact|hello|sales|wholesale|guestrelations|shseducation)@/i.test(
    email,
  );
}

function slugify(value: string): string {
  return cleanMarkdown(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
