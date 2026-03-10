/**
 * Abra Question Detector & Confidence Scoring
 *
 * Detects when Abra asks questions in its replies (indicating uncertainty)
 * and computes a confidence heuristic based on search result quality.
 */

import type { TemporalSearchRow } from "./abra-system-prompt";

/**
 * Detect questions in Abra's reply that indicate it needs user input.
 * Returns the question sentences found.
 */
export function detectQuestions(reply: string): string[] {
  const questions: string[] = [];

  // Split into sentences
  const sentences = reply.split(/(?<=[.!?])\s+|(?<=\n)/g).filter(Boolean);

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    // Direct question marks
    if (trimmed.endsWith("?")) {
      questions.push(trimmed);
      continue;
    }

    // Phrases that indicate uncertainty/request for info
    const uncertaintyPatterns = [
      /^can you (confirm|clarify|verify|provide|share)/i,
      /^could you (confirm|clarify|verify|provide|share)/i,
      /^i('m| am) not (sure|confident|certain)/i,
      /^i need more information/i,
      /^i don't have (information|data|details|context)/i,
      /^can someone (teach|tell|update|inform)/i,
      /^do you (know|have|want)/i,
      /^would you (like|mind|prefer)/i,
      /this may not reflect current/i,
      /i('m| am) not confident this is current/i,
    ];

    for (const pattern of uncertaintyPatterns) {
      if (pattern.test(trimmed)) {
        questions.push(trimmed);
        break;
      }
    }
  }

  return questions;
}

/**
 * Compute a confidence score (0-100) based on search result quality.
 *
 * Factors:
 * - Average similarity of top 3 results
 * - Recency of results (penalize if all are 30+ days old)
 * - Result count
 */
export function computeConfidence(results: TemporalSearchRow[]): number {
  if (results.length === 0) return 0;

  const top = results.slice(0, 3);

  // 1. Similarity score (0-50 points)
  const avgSimilarity =
    top.reduce((sum, r) => sum + (r.similarity || 0), 0) / top.length;
  const simScore = Math.min(avgSimilarity * 55, 50); // 0.91+ sim → full 50 points

  // 2. Recency score (0-30 points)
  const avgDaysAgo =
    top.reduce((sum, r) => sum + (r.days_ago || 0), 0) / top.length;
  let recencyScore: number;
  if (avgDaysAgo <= 7) recencyScore = 30;
  else if (avgDaysAgo <= 30) recencyScore = 25;
  else if (avgDaysAgo <= 90) recencyScore = 15;
  else if (avgDaysAgo <= 365) recencyScore = 5;
  else recencyScore = 0;

  // 3. Result count score (0-20 points)
  const countScore = Math.min(results.length * 4, 20);

  return Math.round(simScore + recencyScore + countScore);
}

/**
 * Should Abra be asking questions instead of guessing?
 */
export function shouldAskQuestions(
  confidence: number,
  results: TemporalSearchRow[],
): boolean {
  // Always ask if confidence is very low
  if (confidence < 40) return true;

  // Ask if all results are very old (90+ days)
  if (results.length > 0) {
    const allOld = results
      .slice(0, 3)
      .every((r) => (r.days_ago || 0) > 90);
    if (allOld) return true;
  }

  return false;
}
