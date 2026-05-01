/**
 * Per-vendor margin ledger parser.
 *
 * Source of truth: /contracts/per-vendor-margin-ledger.md.
 * This module is read-only and intentionally parses markdown into a
 * typed read model. It does not call finance, CRM, commerce, email, chat, or
 * any external system. Unknown/TBD cells remain null or flagged.
 */

export type MarginAlert = "below_floor" | "thin" | "healthy" | "unknown";

export interface MarginRange {
  min: number;
  max: number;
}

export interface LedgerField {
  label: string;
  value: string;
  source: string | null;
  needsActual: boolean;
}

export interface CommittedVendorMargin {
  section: string;
  name: string;
  slug: string;
  fields: Record<string, LedgerField>;
  pricePerBagUsd: number | null;
  operatingCogsUsd: number | null;
  freightPerBagUsd: MarginRange | null;
  gpPerBagUsd: MarginRange | null;
  gpPct: MarginRange | null;
  statusLabel: string | null;
  marginAlert: MarginAlert;
}

export interface ChannelMarginRow {
  channel: string;
  pricePerBag: string;
  effectiveCogs: string;
  freight: string;
  gpPerBag: string;
  gpPct: string;
  see: string;
  marginAlert: MarginAlert;
}

export interface PendingVendorMargin {
  vendor: string;
  stage: string;
  lastTouch: string;
  hubSpotDeal: string;
  likelyTierOnCommit: string;
}

export interface PerVendorMarginLedger {
  status: string | null;
  version: string | null;
  committedVendors: CommittedVendorMargin[];
  channelRows: ChannelMarginRow[];
  pendingVendors: PendingVendorMargin[];
}

export function parsePerVendorMarginLedger(
  markdown: string,
): PerVendorMarginLedger {
  return {
    status: extractBoldMeta(markdown, "Status"),
    version: extractVersion(markdown),
    committedVendors: parseCommittedVendors(markdown),
    channelRows: parseChannelRows(markdown),
    pendingVendors: parsePendingVendors(markdown),
  };
}

export function slugifyVendorName(name: string): string {
  return normalizeText(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseUsdRange(value: string): MarginRange | null {
  const cleaned = normalizeMinus(value).replace(/,/g, "");
  const matches = Array.from(
    cleaned.matchAll(/(^|[^0-9])(-?)\$\s*([0-9]+(?:\.[0-9]+)?)/g),
  )
    .map((match) => Number(`${match[2] ?? ""}${match[3]}`))
    .filter((n) => Number.isFinite(n));
  if (matches.length === 0) return null;
  if (matches.length === 1) return { min: matches[0], max: matches[0] };
  return { min: Math.min(...matches), max: Math.max(...matches) };
}

export function parsePercentRange(value: string): MarginRange | null {
  const cleaned = normalizeMinus(value);
  const matches = Array.from(cleaned.matchAll(/-?[0-9]+(?:\.[0-9]+)?\s*%/g))
    .map((match) => Number(match[0].replace(/[%\s]/g, "")))
    .filter((n) => Number.isFinite(n));
  if (matches.length === 0) return null;
  if (matches.length === 1) return { min: matches[0], max: matches[0] };
  return { min: Math.min(...matches), max: Math.max(...matches) };
}

function parseCommittedVendors(markdown: string): CommittedVendorMargin[] {
  const section = sectionBetween(markdown, "## 1.", "## 2.");
  if (!section) return [];
  const globalCogs = parseGlobalOperatingCogs(markdown);
  const chunks = section.split(/\n(?=###\s+1\.\d+\s+)/g);
  const vendors: CommittedVendorMargin[] = [];
  for (const chunk of chunks) {
    const heading = chunk.match(/^###\s+(1\.\d+)\s+(.+)$/m);
    if (!heading) continue;
    const [, sectionId, rawName] = heading;
    const name = normalizeText(rawName);
    const fields = parseFieldTable(chunk);
    const priceField =
      fields["$/bag (wholesale)"] ??
      fields["$/bag"] ??
      fields["$/bag effective"];
    const cogsField = fields["Operating COGS"] ?? fields["COGS"];
    const freightField =
      fields["Per-bag freight (allocated)"] ?? fields["Per-bag freight"];
    const gpField = fields["GP / bag"] ?? fields["**GP / bag**"];
    const gpText = `${gpField?.value ?? ""} ${gpField?.source ?? ""}`;
    vendors.push({
      section: sectionId,
      name,
      slug: slugifyVendorName(name),
      fields,
      pricePerBagUsd: fieldUsd(priceField),
      operatingCogsUsd: fieldUsd(cogsField) ?? globalCogs,
      freightPerBagUsd: fieldRange(freightField),
      gpPerBagUsd: parseUsdRange(gpText),
      gpPct: parsePercentRange(gpText),
      statusLabel: fields.Status?.value ?? null,
      marginAlert: classifyMargin(parsePercentRange(gpText), gpText),
    });
  }
  return vendors;
}

function parseChannelRows(markdown: string): ChannelMarginRow[] {
  const section = sectionBetween(markdown, "## 2.", "## 3.");
  if (!section) return [];
  const table = rowsFromMarkdownTable(section);
  return table
    .filter((row) => row.length >= 7 && row[0] !== "Channel")
    .map((row) => ({
      channel: normalizeText(row[0]),
      pricePerBag: normalizeText(row[1]),
      effectiveCogs: normalizeText(row[2]),
      freight: normalizeText(row[3]),
      gpPerBag: normalizeText(row[4]),
      gpPct: normalizeText(row[5]),
      see: normalizeText(row[6]),
      marginAlert: classifyMargin(parsePercentRange(row[5]), row[5]),
    }));
}

function parsePendingVendors(markdown: string): PendingVendorMargin[] {
  const section = sectionBetween(markdown, "## 3.", "## 4.");
  if (!section) return [];
  const table = rowsFromMarkdownTable(section);
  return table
    .filter((row) => row.length >= 5 && row[0] !== "Vendor")
    .map((row) => ({
      vendor: normalizeText(row[0]),
      stage: normalizeText(row[1]),
      lastTouch: normalizeText(row[2]),
      hubSpotDeal: normalizeText(row[3]),
      likelyTierOnCommit: normalizeText(row[4]),
    }));
}

function parseFieldTable(chunk: string): Record<string, LedgerField> {
  const rows = rowsFromMarkdownTable(chunk);
  const fields: Record<string, LedgerField> = {};
  for (const row of rows) {
    if (row.length < 2 || row[0] === "Field") continue;
    const label = normalizeText(row[0]);
    if (!label) continue;
    const value = normalizeText(row[1]);
    const source = row[2] ? normalizeText(row[2]) || null : null;
    fields[label] = {
      label,
      value,
      source,
      needsActual: /\bneeds\b.*\bactual\b/i.test(`${value} ${source ?? ""}`),
    };
  }
  return fields;
}

function rowsFromMarkdownTable(markdown: string): string[][] {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !/^\|\s*-+/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    );
}

function sectionBetween(
  markdown: string,
  startHeadingPrefix: string,
  endHeadingPrefix: string,
): string | null {
  const start = markdown.indexOf(startHeadingPrefix);
  if (start < 0) return null;
  const end = markdown.indexOf(endHeadingPrefix, start + startHeadingPrefix.length);
  return markdown.slice(start, end < 0 ? undefined : end);
}

function extractBoldMeta(markdown: string, label: string): string | null {
  const pattern = new RegExp(String.raw`\*\*${label}:\*\*\s*([^\n]+)`, "i");
  const match = markdown.match(pattern);
  return match ? normalizeText(match[1]) : null;
}

function extractVersion(markdown: string): string | null {
  const status = extractBoldMeta(markdown, "Status");
  return status?.match(/\bv[0-9]+(?:\.[0-9]+)?\b/i)?.[0] ?? null;
}

function fieldUsd(field: LedgerField | undefined): number | null {
  const range = fieldRange(field);
  if (!range || field?.needsActual) return null;
  return range.min === range.max ? range.min : null;
}

function fieldRange(field: LedgerField | undefined): MarginRange | null {
  if (!field || field.needsActual || /\bTBD\b/i.test(field.value)) return null;
  return parseUsdRange(field.value);
}

function parseGlobalOperatingCogs(markdown: string): number | null {
  const match = markdown.match(/Operating COGS[\s\S]{0,120}?\$([0-9]+(?:\.[0-9]+)?)/i);
  return match ? Number(match[1]) : null;
}

function classifyMargin(range: MarginRange | null, raw: string): MarginAlert {
  if (/\bNEG\b|negative/i.test(raw)) return "below_floor";
  if (!range) return "unknown";
  if (range.min < 0) return "below_floor";
  if (range.max < 15) return "thin";
  return "healthy";
}

function normalizeText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMinus(value: string): string {
  return value.replace(/[−–—]/g, "-");
}
