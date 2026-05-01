import type { QuoteCandidate } from "./off-grid-quotes";
import type { BoothQuote } from "@/lib/sales-tour/booth-visit-types";

export interface BoothQuoteCandidateProjection {
  candidates: QuoteCandidate[];
  skippedReason: string | null;
}

export function parseStoredBoothQuote(value: unknown): BoothQuote | null {
  const parsed =
    typeof value === "string"
      ? safeJsonParse(value)
      : value && typeof value === "object"
        ? value
        : null;
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Partial<BoothQuote> & { createdAt?: unknown };
  if (!record.intent || typeof record.intent !== "object") return null;
  if (!Array.isArray(record.lines)) return null;
  if (typeof record.visitId !== "string" || !record.visitId.trim()) {
    return null;
  }
  return record as BoothQuote;
}

export function boothQuoteToCandidates(
  quote: BoothQuote & { createdAt?: string },
  fallbackCreatedAt: string,
): BoothQuoteCandidateProjection {
  const bagCount = quote.intent.totalBags;
  if (!Number.isFinite(bagCount) || bagCount <= 0) {
    return { candidates: [], skippedReason: "missing_bag_count" };
  }

  const createdAt =
    typeof quote.createdAt === "string" && quote.createdAt.trim()
      ? quote.createdAt
      : fallbackCreatedAt;
  const customerName =
    quote.intent.prospectName?.trim() || `Booth visit ${quote.visitId}`;

  const candidates: QuoteCandidate[] = [];
  for (const [index, line] of quote.lines.entries()) {
    if (!Number.isFinite(line.pricePerBag) || line.pricePerBag <= 0) continue;
    candidates.push({
      id: `${quote.visitId}:${index}`,
      source: "booth_quote",
      customerName,
      pricePerBagUsd: line.pricePerBag,
      bagCount,
      createdAt,
      createdBy: "sales-tour-booth-quote",
    });
  }

  return {
    candidates,
    skippedReason: candidates.length === 0 ? "no_priced_lines" : null,
  };
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
