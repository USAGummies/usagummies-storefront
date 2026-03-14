/**
 * Shared input validation utilities for Abra API routes.
 *
 * Every route that interpolates user input into PostgREST URLs
 * or stores user-provided data should use these helpers.
 */

/** Standard UUID v4 format */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Notion page IDs are 32 hex chars (no dashes) */
const NOTION_PAGE_ID_RE = /^[0-9a-f]{32}$/i;

export function isValidUUID(value: string): boolean {
  return UUID_RE.test(value);
}

export function isValidNotionPageId(value: string): boolean {
  return NOTION_PAGE_ID_RE.test(value);
}

/**
 * Truncate a string to a safe length for titles, labels, etc.
 * Default: 200 characters.
 */
export function sanitizeTitle(value: string, maxLen = 200): string {
  return value.slice(0, maxLen).trim();
}

/**
 * Truncate a string to a safe length for body text, descriptions, etc.
 * Default: 5000 characters.
 */
export function sanitizeText(value: string, maxLen = 5000): string {
  return value.slice(0, maxLen).trim();
}

/**
 * Validate a date string in YYYY-MM-DD format and check it parses to a real date.
 */
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return !isNaN(d.getTime());
}

/**
 * Safely encode a value for use in PostgREST filter URLs.
 * Always use this when interpolating user input into `?column=eq.${value}` patterns.
 */
export function pgFilterValue(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Known departments — used to validate department inputs where a DB lookup
 * would be too expensive for every request.
 */
const KNOWN_DEPARTMENTS = new Set([
  "executive",
  "finance",
  "operations",
  "sales_and_growth",
  "marketing",
  "systems",
  "product",
]);

export function isKnownDepartment(value: string): boolean {
  return KNOWN_DEPARTMENTS.has(value.toLowerCase());
}

/**
 * Email recipient validation for outbound messages.
 */
const ALLOWED_EMAIL_DOMAINS = new Set(["usagummies.com", "gmail.com"]);
const ALLOWED_EMAIL_ADDRESSES = new Set([
  "ben@usagummies.com",
  "benjamin.stutman@gmail.com",
]);

export function isAllowedEmailRecipient(email: string): boolean {
  const normalized = email.toLowerCase().trim();
  if (ALLOWED_EMAIL_ADDRESSES.has(normalized)) return true;
  const domain = normalized.split("@")[1];
  return domain ? ALLOWED_EMAIL_DOMAINS.has(domain) : false;
}
