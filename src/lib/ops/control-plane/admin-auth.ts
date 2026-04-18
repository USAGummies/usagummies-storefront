/**
 * Shared CRON_SECRET bearer-auth helper for control-plane operator
 * routes. Timing-safe compare, fail-closed if the secret isn't configured.
 *
 * Used by:
 *   - /api/ops/control-plane/drift-audit
 *   - /api/ops/control-plane/violations
 *   - /api/ops/control-plane/corrections
 *   - /api/ops/control-plane/paused
 *   - /api/ops/control-plane/unpause
 *   - /api/ops/control-plane/scorecards
 *   - /api/ops/control-plane/approvals
 *   - /api/ops/control-plane/audit
 *   - /api/ops/control-plane/health
 *   - /api/ops/daily-brief
 */

export function isCronAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false; // fail-closed when secret missing
  const header = req.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : header.trim();
  if (!supplied) return false;
  if (supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < supplied.length; i++) {
    diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
