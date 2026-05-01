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

export interface VendorMarginAlert {
  slug: string;
  name: string;
  marginAlert: MarginAlert;
  pricePerBagUsd: number | null;
  gpPerBagUsd: MarginRange | null;
  gpPct: MarginRange | null;
  statusLabel: string | null;
  reason: string;
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

export function selectVendorMarginAlerts(
  ledger: PerVendorMarginLedger,
  limit = 3,
): VendorMarginAlert[] {
  return ledger.committedVendors
    .map(toMarginAlert)
    .filter((alert): alert is VendorMarginAlert => alert !== null)
    .sort((a, b) => alertRank(a.marginAlert) - alertRank(b.marginAlert))
    .slice(0, Math.max(0, limit));
}

/**
 * Phase 36.4 — render a HubSpot deal note line with the per-bag economics
 * for a given committed vendor. Used by the buy-label endpoint to append
 * vendor-margin context to the auto-shipment note when a deal advances
 * to `Shipped`. Returns null if the vendor isn't on the committed roster
 * (no over-promising margin data we don't have).
 *
 * Output shape (single line):
 *   "Margin context: $2.10/bag · GP $0.13/bag (6%) · status: Active —
 *    Inderbitzin (Distributor Opt B)"
 *
 * Caller passes the parsed ledger + a vendor lookup query (HubSpot deal
 * name, customer name, etc). Uses the same fuzzy slug match as the
 * `/api/ops/finance/vendor-margin` endpoint so the deal note shows the
 * SAME vendor row that surfaces in the morning brief.
 */
export function renderVendorMarginNoteLine(
  ledger: PerVendorMarginLedger,
  vendorQuery: string,
): string | null {
  if (!vendorQuery?.trim()) return null;
  const slug = slugifyVendorName(vendorQuery);
  // First significant word of the query (e.g. "Inderbitzin" from
  // "Inderbitzin Distributing"). Used to match against vendor names that
  // include parenthetical descriptors like "Inderbitzin (regional distributor, WA)".
  const queryFirstToken = slug.split("-")[0] ?? "";
  const vendor =
    ledger.committedVendors.find((v) => {
      const vendorFirstToken = v.slug.split("-")[0] ?? "";
      return (
        v.slug === slug ||
        v.slug.includes(slug) ||
        slug.includes(v.slug) ||
        v.name.toLowerCase().includes(vendorQuery.toLowerCase()) ||
        vendorQuery.toLowerCase().includes(v.name.toLowerCase()) ||
        // First-token match — handles parenthetical descriptors
        // (e.g. query "Inderbitzin Distributing" matches vendor
        // "Inderbitzin (regional distributor, WA)" via shared first token).
        (vendorFirstToken.length >= 4 &&
          queryFirstToken.length >= 4 &&
          vendorFirstToken === queryFirstToken)
      );
    }) ?? null;
  if (!vendor) return null;

  const parts: string[] = [];
  if (vendor.pricePerBagUsd != null) {
    parts.push(`$${vendor.pricePerBagUsd.toFixed(2)}/bag`);
  }
  if (vendor.gpPerBagUsd) {
    const lo = vendor.gpPerBagUsd.min;
    const hi = vendor.gpPerBagUsd.max;
    const range =
      Math.abs(hi - lo) < 0.01
        ? `$${lo.toFixed(2)}/bag`
        : `$${lo.toFixed(2)}–$${hi.toFixed(2)}/bag`;
    parts.push(`GP ${range}`);
  }
  if (vendor.gpPct) {
    const lo = vendor.gpPct.min;
    const hi = vendor.gpPct.max;
    const pct =
      Math.abs(hi - lo) < 0.5
        ? `${Math.round(lo)}%`
        : `${Math.round(lo)}–${Math.round(hi)}%`;
    parts.push(`(${pct})`);
  }
  if (vendor.statusLabel) parts.push(`status: ${vendor.statusLabel}`);

  if (parts.length === 0) return null;
  return `Margin context: ${parts.join(" · ")} — ${vendor.name}`;
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

function toMarginAlert(vendor: CommittedVendorMargin): VendorMarginAlert | null {
  if (vendor.marginAlert !== "healthy") {
    return {
      slug: vendor.slug,
      name: vendor.name,
      marginAlert: vendor.marginAlert,
      pricePerBagUsd: vendor.pricePerBagUsd,
      gpPerBagUsd: vendor.gpPerBagUsd,
      gpPct: vendor.gpPct,
      statusLabel: vendor.statusLabel,
      reason: reasonForVendor(vendor),
    };
  }

  const needsActual = Object.values(vendor.fields).some((field) => field.needsActual);
  if (needsActual) {
    return {
      slug: vendor.slug,
      name: vendor.name,
      marginAlert: "unknown",
      pricePerBagUsd: vendor.pricePerBagUsd,
      gpPerBagUsd: vendor.gpPerBagUsd,
      gpPct: vendor.gpPct,
      statusLabel: vendor.statusLabel,
      reason: "needs actuals before margin can be trusted",
    };
  }

  return null;
}

function reasonForVendor(vendor: CommittedVendorMargin): string {
  if (vendor.marginAlert === "below_floor") return "below margin floor";
  if (vendor.marginAlert === "thin") return "thin margin";
  return "missing margin actuals";
}

function alertRank(alert: MarginAlert): number {
  if (alert === "below_floor") return 0;
  if (alert === "thin") return 1;
  if (alert === "unknown") return 2;
  return 3;
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
