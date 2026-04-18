/**
 * Booth access gate — the /booth wholesale order form is meant to only be
 * reachable via QR scan from the in-person booth display or printed sales
 * sheet. The QR encodes `/booth?k=<BOOTH_ACCESS_KEY>`; visiting `/booth`
 * without the key redirects to the public /wholesale lead-capture page.
 *
 * Rotate the key per show (e.g. `the-reunion-2026` → `expo-west-2026`) so
 * stale URLs from prior shows stop working when you reprint QRs.
 */
export const BOOTH_ACCESS_KEY = "the-reunion-2026";
