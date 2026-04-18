/**
 * Auth helpers for control-plane operator routes. Two tiers:
 *
 * Tier 1 — CRON_SECRET (scheduled + low-authority endpoints).
 *   Header: `Authorization: Bearer <CRON_SECRET>`
 *   Used by: drift-audit, daily-brief, violations (POST + GET),
 *            corrections (POST + GET), paused (GET), scorecards (GET),
 *            approvals (GET), audit (GET), health (GET).
 *
 * Tier 2 — CONTROL_PLANE_ADMIN_SECRET (high-authority mutations).
 *   Header: `X-Admin-Authorization: Bearer <CONTROL_PLANE_ADMIN_SECRET>`
 *   Used by: unpause (POST). Intended for routes where trusting the
 *   scheduled-job CRON_SECRET would let any scheduled caller bypass
 *   a governance invariant (e.g. "Ben is the only human who may
 *   unpause" per blueprint §6.2).
 *
 *   The admin secret lives in a separate env var and uses a distinct
 *   header name so that accidental reuse of CRON_SECRET — or a Make.com
 *   scenario configured with only CRON_SECRET — cannot escalate to
 *   admin authority. Timing-safe compare, fail-closed on missing env.
 */

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function isCronAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false; // fail-closed when secret missing
  const header = req.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : header.trim();
  if (!supplied) return false;
  return timingSafeEquals(supplied, expected);
}

/**
 * Admin-tier auth for mutations that must not be reachable by ordinary
 * scheduled callers. Requires the SEPARATE `X-Admin-Authorization`
 * header (not `Authorization`) so a CRON_SECRET-only caller cannot
 * accidentally satisfy this check if the two secrets happen to be
 * equal by operator mistake.
 */
export function isAdminAuthorized(req: Request): boolean {
  const expected = process.env.CONTROL_PLANE_ADMIN_SECRET?.trim();
  if (!expected) return false; // fail-closed
  const header = req.headers.get("x-admin-authorization") ?? "";
  const supplied = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : header.trim();
  if (!supplied) return false;
  return timingSafeEquals(supplied, expected);
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
