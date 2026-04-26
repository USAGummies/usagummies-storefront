/**
 * Cursor for the email-intelligence scan window.
 *
 * Each cron tick scans Gmail for `after:<lastCursor>` so we don't repeat
 * work. The cursor is a Unix-second timestamp stored in KV. On boot we
 * default to "12 hours ago" so a fresh deploy doesn't scan years of mail.
 */
import { kv } from "@vercel/kv";

const KV_CURSOR_KEY = "email-intel:cursor:gmail";
const DEFAULT_LOOKBACK_SECONDS = 12 * 3600;

export async function readCursor(): Promise<number> {
  try {
    const v = await kv.get<number>(KV_CURSOR_KEY);
    if (typeof v === "number" && v > 0) return v;
  } catch {
    // Fall through to default.
  }
  return Math.floor(Date.now() / 1000) - DEFAULT_LOOKBACK_SECONDS;
}

export async function writeCursor(unixSeconds: number): Promise<void> {
  try {
    await kv.set(KV_CURSOR_KEY, unixSeconds);
  } catch {
    // Non-fatal — drift audit catches if cursor isn't advancing.
  }
}

/**
 * Build the Gmail "after:" search-query fragment from a Unix-seconds cursor.
 * Gmail uses YYYY/MM/DD format for `after:` so we round down a day to be safe.
 */
export function gmailAfterFragment(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  // Round back one full day to give Gmail's index time to settle.
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 1);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `after:${yyyy}/${mm}/${dd}`;
}
