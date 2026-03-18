/**
 * Auth Audit Trail — Enterprise Security Logging
 *
 * Logs all authentication events to Supabase for compliance:
 *   - Login success / failure
 *   - Session expired
 *   - Role-based access denied
 *   - Break-glass admin usage
 *   - Suspicious activity (brute force, unknown IPs)
 *
 * Fire-and-forget: never blocks auth flow.
 */

export type AuthAuditEvent =
  | "login_success"
  | "login_failure"
  | "session_expired"
  | "role_check_denied"
  | "break_glass_used"
  | "unauthorized_api_access"
  | "rate_limited"
  | "password_changed"
  | "user_created"
  | "user_deactivated";

type AuditEntry = {
  event_type: AuthAuditEvent;
  user_email?: string;
  user_id?: string;
  user_role?: string;
  ip_address?: string;
  user_agent?: string;
  route?: string;
  metadata?: Record<string, unknown>;
};

// Buffer audit events to batch-insert every 5 seconds
let buffer: AuditEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 5000;
const MAX_BUFFER_SIZE = 50;

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function flushBuffer(): Promise<void> {
  if (buffer.length === 0) return;

  const entries = [...buffer];
  buffer = [];

  const env = getSupabaseEnv();
  if (!env) {
    console.warn("[auth-audit] Supabase not configured, dropping", entries.length, "audit entries");
    return;
  }

  try {
    const res = await fetch(`${env.baseUrl}/rest/v1/auth_audit_log`, {
      method: "POST",
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(entries),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[auth-audit] Flush failed:", res.status, text.slice(0, 200));
    }
  } catch (err) {
    console.error("[auth-audit] Flush error:", err instanceof Error ? err.message : err);
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushBuffer().catch(() => {});
  }, FLUSH_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Log an authentication event. Fire-and-forget — never blocks.
 */
export function logAuthEvent(entry: AuditEntry): void {
  buffer.push(entry);

  if (buffer.length >= MAX_BUFFER_SIZE) {
    flushBuffer().catch(() => {});
  } else {
    scheduleFlush();
  }
}

/**
 * Extract client IP from request headers.
 */
export function extractIP(req: Request): string {
  const headers = new Headers(req.headers);
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Extract user agent from request.
 */
export function extractUserAgent(req: Request): string {
  return req.headers.get("user-agent")?.slice(0, 200) || "unknown";
}

/**
 * Get recent auth audit events (for the security dashboard).
 */
export async function getRecentAuthEvents(
  limit: number = 100,
  eventType?: AuthAuditEvent,
): Promise<AuditEntry[]> {
  const env = getSupabaseEnv();
  if (!env) return [];

  try {
    let path = `/rest/v1/auth_audit_log?select=*&order=created_at.desc&limit=${limit}`;
    if (eventType) {
      path += `&event_type=eq.${eventType}`;
    }

    const res = await fetch(`${env.baseUrl}${path}`, {
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return [];
    return (await res.json()) as AuditEntry[];
  } catch {
    return [];
  }
}

/**
 * Get failed login count in the last N minutes (for brute force detection).
 */
export async function getRecentFailedLogins(
  email: string,
  minutesBack: number = 15,
): Promise<number> {
  const env = getSupabaseEnv();
  if (!env) return 0;

  try {
    const since = new Date(Date.now() - minutesBack * 60 * 1000).toISOString();
    const path = `/rest/v1/auth_audit_log?select=id&event_type=eq.login_failure&user_email=eq.${encodeURIComponent(email)}&created_at=gte.${since}`;

    const res = await fetch(`${env.baseUrl}${path}`, {
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        Prefer: "count=exact",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return 0;
    const count = res.headers.get("content-range")?.split("/")[1];
    return count ? parseInt(count, 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Get auth event summary stats for the security dashboard.
 */
export async function getAuthStats(
  hoursBack: number = 24,
): Promise<{
  totalEvents: number;
  loginSuccess: number;
  loginFailure: number;
  unauthorized: number;
  breakGlass: number;
}> {
  const env = getSupabaseEnv();
  if (!env) {
    return {
      totalEvents: 0,
      loginSuccess: 0,
      loginFailure: 0,
      unauthorized: 0,
      breakGlass: 0,
    };
  }

  try {
    const since = new Date(
      Date.now() - hoursBack * 60 * 60 * 1000,
    ).toISOString();
    const path = `/rest/v1/auth_audit_log?select=event_type&created_at=gte.${since}`;

    const res = await fetch(`${env.baseUrl}${path}`, {
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return {
        totalEvents: 0,
        loginSuccess: 0,
        loginFailure: 0,
        unauthorized: 0,
        breakGlass: 0,
      };
    }

    const rows = (await res.json()) as Array<{ event_type: string }>;
    return {
      totalEvents: rows.length,
      loginSuccess: rows.filter((r) => r.event_type === "login_success")
        .length,
      loginFailure: rows.filter((r) => r.event_type === "login_failure")
        .length,
      unauthorized: rows.filter(
        (r) => r.event_type === "unauthorized_api_access",
      ).length,
      breakGlass: rows.filter((r) => r.event_type === "break_glass_used")
        .length,
    };
  } catch {
    return {
      totalEvents: 0,
      loginSuccess: 0,
      loginFailure: 0,
      unauthorized: 0,
      breakGlass: 0,
    };
  }
}
