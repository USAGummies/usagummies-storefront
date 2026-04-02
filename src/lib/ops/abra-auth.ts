/**
 * Auth utilities — kept for QBO API routes.
 */
import { auth } from "@/lib/auth/config";
import { logAuthEvent, extractIP, extractUserAgent } from "@/lib/ops/auth-audit";

export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const authHeader = req.headers.get("authorization")?.trim();
  if (!authHeader) return false;
  return authHeader === `Bearer ${secret}`;
}

export async function isAuthorized(req: Request): Promise<boolean> {
  try {
    const session = await auth();
    if (session?.user?.email) return true;
  } catch { /* ignore */ }
  if (isCronAuthorized(req)) return true;
  logAuthEvent({
    event_type: "unauthorized_api_access",
    ip_address: extractIP(req),
    user_agent: extractUserAgent(req),
    route: new URL(req.url).pathname,
  });
  return false;
}
