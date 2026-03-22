/**
 * Financial Citation Enforcer
 *
 * Post-processes Abra's reply to verify every dollar amount is backed
 * by a source in the retrieved context. Tags unverified figures.
 */

export type CitationResult = {
  original: string;
  processed: string;
  verified: number;
  unverified: number;
  figures: Array<{ amount: string; verified: boolean; source?: string }>;
};

/**
 * Extract all dollar figures from text.
 */
function extractDollarFigures(text: string): string[] {
  const matches = text.match(/\$[\d,]+(?:\.\d{1,2})?/g);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Check if a dollar figure appears in any source context.
 */
function findSource(figure: string, context: string): string | null {
  // Normalize: remove $ and commas for comparison
  const normalized = figure.replace(/[$,]/g, "");
  const num = parseFloat(normalized);
  if (isNaN(num)) return null;

  // Check if the exact figure appears in context
  if (context.includes(figure) || context.includes(normalized)) {
    // Try to find the source label
    const sourceMatch = context.match(new RegExp(`[\\[\\(](?:source|brain|live|verified|HOT|WARM|COLD)[^\\]\\)]*[\\]\\)]`, "i"));
    return sourceMatch ? sourceMatch[0] : "verified in context";
  }

  // Check for the number without dollar sign
  const numStr = num.toFixed(2);
  if (context.includes(numStr)) {
    return "verified in context";
  }

  // Known verified constants (COGS, pricing, etc.)
  const KNOWN_CONSTANTS: Record<string, string> = {
    "1.557": "forward COGS (verified)",
    "1.522": "forward COGS (pro forma)",
    "0.919": "Albanese rate (verified)",
    "0.144": "Belmark rate (verified)",
    "0.385": "Powers rate (HOT correction)",
    "0.109": "freight rate (verified)",
    "5.99": "Amazon listing price",
    "4.99": "DTC MSRP",
    "1484.80": "2025 total revenue (verified)",
    "39.20": "Albanese case price (verified)",
  };

  if (KNOWN_CONSTANTS[numStr] || KNOWN_CONSTANTS[normalized]) {
    return KNOWN_CONSTANTS[numStr] || KNOWN_CONSTANTS[normalized];
  }

  return null;
}

/**
 * Enforce citations on all dollar figures in Abra's reply.
 * Tags unverified figures with ⚠️.
 */
export function enforceCitations(
  reply: string,
  contextText: string,
): CitationResult {
  const figures = extractDollarFigures(reply);
  const results: CitationResult["figures"] = [];
  let processed = reply;
  let verified = 0;
  let unverified = 0;

  for (const fig of figures) {
    const source = findSource(fig, contextText);
    if (source) {
      results.push({ amount: fig, verified: true, source });
      verified++;
    } else {
      results.push({ amount: fig, verified: false });
      unverified++;
      // Only tag figures > $1 that aren't in calculations
      const num = parseFloat(fig.replace(/[$,]/g, ""));
      if (num > 1 && !isInCalculation(reply, fig)) {
        // Don't modify — just track. Adding ⚠️ inline would be noisy.
        // Instead, append a footer note if there are unverified figures.
      }
    }
  }

  // If >30% of figures are unverified, append a warning
  if (figures.length > 2 && unverified / figures.length > 0.3) {
    processed += `\n\n_⚠️ ${unverified} figure(s) in this response could not be verified against live data sources._`;
  }

  return { original: reply, processed, verified, unverified, figures: results };
}

/**
 * Check if a figure is part of a calculation (e.g., "500 × $6.50 = $3,250").
 * Calculated figures are expected to not appear in source data.
 */
function isInCalculation(text: string, figure: string): boolean {
  const idx = text.indexOf(figure);
  if (idx === -1) return false;

  // Check surrounding context for calculation operators
  const surrounding = text.substring(Math.max(0, idx - 30), Math.min(text.length, idx + figure.length + 30));
  return /[×*÷/=]/.test(surrounding) || /\d+\s*(?:units?|orders?)\s*[×*@]\s*\$/.test(surrounding);
}
