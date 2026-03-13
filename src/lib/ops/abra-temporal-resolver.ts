/**
 * Abra Temporal Resolver
 *
 * Detects temporal references in user messages ("yesterday", "last Tuesday",
 * "March 12", "this week") and resolves them to date ranges. Used to
 * supplement semantic search with date-based direct queries so that
 * "what were yesterday's orders?" actually finds entries from yesterday.
 */

export type TemporalRange = {
  label: string;              // Human-readable: "yesterday", "last Monday"
  start: string;              // ISO date: "2026-03-12"
  end: string;                // ISO date (inclusive): "2026-03-12"
  confidence: "high" | "medium"; // How sure we are about the parse
};

/**
 * Parse a user message for temporal references and resolve to date range(s).
 * Returns null if no temporal intent detected.
 *
 * Uses the PT (Pacific) timezone for date resolution since that's the business TZ.
 */
export function resolveTemporalDates(message: string): TemporalRange | null {
  const lower = message.toLowerCase().trim();
  const now = getPTDate();

  // "yesterday"
  if (/\byesterday\b/.test(lower)) {
    const d = addDays(now, -1);
    return { label: "yesterday", start: fmt(d), end: fmt(d), confidence: "high" };
  }

  // "today"
  if (/\btoday\b/.test(lower) && /\b(order|revenue|sale|amazon|shopify|data|number|result)\b/.test(lower)) {
    return { label: "today", start: fmt(now), end: fmt(now), confidence: "high" };
  }

  // "day before yesterday" / "two days ago"
  if (/\b(day before yesterday|2 days? ago|two days? ago)\b/.test(lower)) {
    const d = addDays(now, -2);
    return { label: "2 days ago", start: fmt(d), end: fmt(d), confidence: "high" };
  }

  // "N days ago"
  const daysAgoMatch = lower.match(/\b(\d+)\s+days?\s+ago\b/);
  if (daysAgoMatch) {
    const n = parseInt(daysAgoMatch[1], 10);
    if (n >= 1 && n <= 90) {
      const d = addDays(now, -n);
      return { label: `${n} days ago`, start: fmt(d), end: fmt(d), confidence: "high" };
    }
  }

  // "last week"
  if (/\blast week\b/.test(lower)) {
    const dayOfWeek = now.getDay(); // 0=Sun
    const lastSunday = addDays(now, -(dayOfWeek + 7));
    const lastSaturday = addDays(lastSunday, 6);
    return { label: "last week", start: fmt(lastSunday), end: fmt(lastSaturday), confidence: "high" };
  }

  // "this week"
  if (/\bthis week\b/.test(lower)) {
    const dayOfWeek = now.getDay();
    const thisSunday = addDays(now, -dayOfWeek);
    return { label: "this week", start: fmt(thisSunday), end: fmt(now), confidence: "high" };
  }

  // "last Monday", "last Tuesday", etc.
  const lastDayMatch = lower.match(/\blast\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (lastDayMatch) {
    const targetDay = dayNameToNumber(lastDayMatch[1]);
    const d = findLastWeekday(now, targetDay);
    return { label: `last ${lastDayMatch[1]}`, start: fmt(d), end: fmt(d), confidence: "high" };
  }

  // "on Monday", "on Tuesday" (assumes most recent past occurrence)
  const onDayMatch = lower.match(/\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (onDayMatch) {
    const targetDay = dayNameToNumber(onDayMatch[1]);
    const d = findLastWeekday(now, targetDay);
    return { label: onDayMatch[1], start: fmt(d), end: fmt(d), confidence: "medium" };
  }

  // "March 12", "march 12th", "Mar 12"
  const monthDayMatch = lower.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (monthDayMatch) {
    const month = monthNameToNumber(monthDayMatch[1]);
    const day = parseInt(monthDayMatch[2], 10);
    const year = now.getFullYear();
    const d = new Date(year, month, day);
    if (isValidDate(d) && day >= 1 && day <= 31) {
      return { label: `${monthDayMatch[1]} ${day}`, start: fmt(d), end: fmt(d), confidence: "high" };
    }
  }

  // "3/12", "03/12" (MM/DD format)
  const slashDateMatch = lower.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (slashDateMatch) {
    const month = parseInt(slashDateMatch[1], 10) - 1;
    const day = parseInt(slashDateMatch[2], 10);
    const year = now.getFullYear();
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const d = new Date(year, month, day);
      if (isValidDate(d)) {
        return { label: `${slashDateMatch[1]}/${slashDateMatch[2]}`, start: fmt(d), end: fmt(d), confidence: "medium" };
      }
    }
  }

  // "2026-03-12" (ISO format)
  const isoMatch = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return { label: isoMatch[0], start: isoMatch[0], end: isoMatch[0], confidence: "high" };
  }

  // "last month"
  if (/\blast month\b/.test(lower)) {
    const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = addDays(firstOfThisMonth, -1);
    const firstOfLastMonth = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1);
    return { label: "last month", start: fmt(firstOfLastMonth), end: fmt(lastMonth), confidence: "high" };
  }

  return null;
}

// ── Helpers ──

function getPTDate(): Date {
  const pt = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  return new Date(pt);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function fmt(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isValidDate(d: Date): boolean {
  return !isNaN(d.getTime());
}

function dayNameToNumber(name: string): number {
  const map: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  return map[name.toLowerCase()] ?? 0;
}

function findLastWeekday(now: Date, targetDay: number): Date {
  const currentDay = now.getDay();
  let diff = currentDay - targetDay;
  if (diff <= 0) diff += 7; // go to previous week
  return addDays(now, -diff);
}

function monthNameToNumber(name: string): number {
  const map: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
    nov: 10, november: 10, dec: 11, december: 11,
  };
  return map[name.toLowerCase()] ?? 0;
}
