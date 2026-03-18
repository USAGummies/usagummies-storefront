/**
 * Centralized error tracking — Phase 6B enterprise hardening.
 *
 * Logs errors to the Supabase `abra_errors` table with deduplication (upsert
 * on error_hash), batch buffering (5-second flush window), severity-based Slack
 * alerts for critical errors, and query helpers for the dashboard.
 */

import { createHash } from "node:crypto";
import { notifyAlert } from "@/lib/ops/notify";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorSeverity = "critical" | "error" | "warning" | "info";

export type TrackedError = {
  id: string;
  error_hash: string;
  message: string;
  stack: string | null;
  source: string;
  severity: ErrorSeverity;
  metadata: Record<string, unknown>;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
};

export type ErrorStats = {
  bySeverity: Record<ErrorSeverity, number>;
  bySource: Record<string, number>;
  totalUnresolved: number;
};

type BufferedEntry = {
  error_hash: string;
  message: string;
  stack: string | null;
  source: string;
  severity: ErrorSeverity;
  metadata: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Supabase helpers (matches codebase convention — raw fetch, no SDK)
// ---------------------------------------------------------------------------

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const env = getSupabaseEnv();
  if (!env) {
    console.warn("[error-tracker] Supabase not configured — skipping");
    return null;
  }

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(
      `[error-tracker] Supabase ${init.method || "GET"} ${path} failed: ${res.status} ${body}`,
    );
    return null;
  }

  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function computeErrorHash(message: string, source: string): string {
  return createHash("sha256")
    .update(`${source}::${message}`)
    .digest("hex")
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// Buffer — collects errors for 5 seconds then flushes in batch
// ---------------------------------------------------------------------------

let buffer: BufferedEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_DELAY_MS = 5_000;

async function flushBuffer(): Promise<void> {
  flushTimer = null;
  if (buffer.length === 0) return;

  const batch = [...buffer];
  buffer = [];

  // Group by hash so we only upsert once per unique error
  const grouped = new Map<string, BufferedEntry & { count: number }>();
  for (const entry of batch) {
    const existing = grouped.get(entry.error_hash);
    if (existing) {
      existing.count += 1;
      // Keep the highest severity
      if (severityRank(entry.severity) < severityRank(existing.severity)) {
        existing.severity = entry.severity;
      }
    } else {
      grouped.set(entry.error_hash, { ...entry, count: 1 });
    }
  }

  const criticalMessages: string[] = [];

  for (const entry of grouped.values()) {
    try {
      // Check if unresolved error with this hash already exists
      const existing = await sbFetch<TrackedError[]>(
        `/rest/v1/abra_errors?error_hash=eq.${entry.error_hash}&resolved=eq.false&select=id,occurrence_count&limit=1`,
        { method: "GET", headers: { Accept: "application/json" } },
      );

      if (existing && existing.length > 0) {
        // Update existing: increment count, update last_seen_at
        const row = existing[0];
        await sbFetch(
          `/rest/v1/abra_errors?id=eq.${row.id}`,
          {
            method: "PATCH",
            headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
            body: JSON.stringify({
              occurrence_count: row.occurrence_count + entry.count,
              last_seen_at: new Date().toISOString(),
              severity: entry.severity,
              metadata: entry.metadata,
            }),
          },
        );
      } else {
        // Insert new error row
        await sbFetch("/rest/v1/abra_errors", {
          method: "POST",
          headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
          body: JSON.stringify({
            error_hash: entry.error_hash,
            message: entry.message,
            stack: entry.stack,
            source: entry.source,
            severity: entry.severity,
            metadata: entry.metadata,
            occurrence_count: entry.count,
            first_seen_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          }),
        });
      }

      if (entry.severity === "critical") {
        criticalMessages.push(
          `[${entry.source}] ${entry.message.slice(0, 200)}`,
        );
      }
    } catch (err) {
      console.error("[error-tracker] flush error:", err);
    }
  }

  // Send Slack notification for critical errors (batched)
  if (criticalMessages.length > 0) {
    const text = [
      `CRITICAL ERROR${criticalMessages.length > 1 ? "S" : ""} (${criticalMessages.length}):`,
      ...criticalMessages.map((m) => `  ${m}`),
    ].join("\n");
    notifyAlert(text, /* sms */ false).catch(() => {
      // best-effort — never let notification failure propagate
    });
  }
}

function severityRank(s: ErrorSeverity): number {
  switch (s) {
    case "critical":
      return 0;
    case "error":
      return 1;
    case "warning":
      return 2;
    case "info":
      return 3;
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushBuffer().catch((err) =>
      console.error("[error-tracker] flushBuffer failed:", err),
    );
  }, FLUSH_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Track an error. Buffers for 5 seconds then flushes to Supabase in batch.
 * Critical errors also trigger a Slack notification.
 */
export function trackError(
  error: unknown,
  source: string,
  severity: ErrorSeverity = "error",
  metadata: Record<string, unknown> = {},
): void {
  const message =
    error instanceof Error ? error.message : String(error);
  const stack =
    error instanceof Error ? (error.stack ?? null) : null;
  const errorHash = computeErrorHash(message, source);

  buffer.push({ error_hash: errorHash, message, stack, source, severity, metadata });
  scheduleFlush();
}

/**
 * Force-flush the buffer immediately (useful before process exit or in tests).
 */
export async function flushErrors(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushBuffer();
}

/**
 * Fetch recent unresolved errors from Supabase.
 */
export async function getRecentErrors(
  limit = 50,
  filters?: { severity?: ErrorSeverity; source?: string; resolved?: boolean },
): Promise<TrackedError[]> {
  const params: string[] = [`order=last_seen_at.desc`, `limit=${limit}`];

  if (filters?.resolved !== undefined) {
    params.push(`resolved=eq.${filters.resolved}`);
  } else {
    params.push("resolved=eq.false");
  }
  if (filters?.severity) {
    params.push(`severity=eq.${filters.severity}`);
  }
  if (filters?.source) {
    params.push(`source=eq.${filters.source}`);
  }

  const result = await sbFetch<TrackedError[]>(
    `/rest/v1/abra_errors?${params.join("&")}`,
    { method: "GET", headers: { Accept: "application/json" } },
  );

  return result ?? [];
}

/**
 * Mark an error as resolved.
 */
export async function resolveError(
  errorId: string,
  resolvedBy: string,
): Promise<boolean> {
  const result = await sbFetch(
    `/rest/v1/abra_errors?id=eq.${errorId}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
      body: JSON.stringify({
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_by: resolvedBy,
      }),
    },
  );
  // sbFetch returns null on HTTP error, otherwise the (possibly empty) response
  return result !== null;
}

/**
 * Get aggregated error statistics.
 */
export async function getErrorStats(): Promise<ErrorStats> {
  const errors = await sbFetch<TrackedError[]>(
    "/rest/v1/abra_errors?resolved=eq.false&select=severity,source",
    { method: "GET", headers: { Accept: "application/json" } },
  );

  const rows = errors ?? [];

  const bySeverity: Record<ErrorSeverity, number> = {
    critical: 0,
    error: 0,
    warning: 0,
    info: 0,
  };
  const bySource: Record<string, number> = {};

  for (const row of rows) {
    const sev = row.severity as ErrorSeverity;
    if (sev in bySeverity) {
      bySeverity[sev] += 1;
    }
    bySource[row.source] = (bySource[row.source] || 0) + 1;
  }

  return {
    bySeverity,
    bySource,
    totalUnresolved: rows.length,
  };
}
