/**
 * PULSE — Fleet Health Monitoring & Reporting
 *
 * Monitors all specialists (ARCHIVE, FORGE, FREIGHT, LEDGER, etc.),
 * checks data freshness in Vercel KV, and generates health reports.
 */
import { kv } from "@vercel/kv";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type SpecialistStatus = "healthy" | "warning" | "critical" | "unknown";

export type SpecialistHealth = {
  name: string;
  status: SpecialistStatus;
  last_run: string | null;
  last_success: string | null;
  rows_total: number;
  rows_last_24h: number;
  staleness_hours: number;
  error_message?: string;
};

export type FleetHealth = {
  timestamp: string;
  overall_status: SpecialistStatus;
  specialists: SpecialistHealth[];
  alerts: string[];
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const STATUS_ICON: Record<SpecialistStatus, string> = {
  healthy: "\u2705",
  warning: "\u26a0\ufe0f",
  critical: "\u274c",
  unknown: "\u2753",
};

const STATUS_LABEL: Record<SpecialistStatus, string> = {
  healthy: "Healthy",
  warning: "Warning",
  critical: "Critical",
  unknown: "Unknown",
};

function hoursAgo(iso: string | null | undefined): number {
  if (!iso) return Infinity;
  const diff = Date.now() - new Date(iso).getTime();
  return Math.max(0, diff / (1000 * 60 * 60));
}

function statusFromStaleness(hours: number): SpecialistStatus {
  if (!isFinite(hours)) return "unknown";
  if (hours < 24) return "healthy";
  if (hours < 48) return "warning";
  return "critical";
}

function worstStatus(statuses: SpecialistStatus[]): SpecialistStatus {
  const priority: SpecialistStatus[] = ["critical", "unknown", "warning", "healthy"];
  for (const s of priority) {
    if (statuses.includes(s)) return s;
  }
  return "unknown";
}

/** Count items whose timestamp field falls within the last 24 hours. */
function countRecent(
  items: Record<string, unknown>[],
  tsField: string,
): number {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return items.filter((i) => {
    const ts = i[tsField];
    if (typeof ts !== "string") return false;
    return new Date(ts).getTime() >= cutoff;
  }).length;
}

/** Safely get latest timestamp from an array of records. */
function latestTimestamp(
  items: Record<string, unknown>[],
  tsField: string,
): string | null {
  let latest: string | null = null;
  for (const item of items) {
    const ts = item[tsField];
    if (typeof ts !== "string") continue;
    if (!latest || ts > latest) latest = ts;
  }
  return latest;
}

/* ------------------------------------------------------------------ */
/*  Specialist checkers                                                */
/* ------------------------------------------------------------------ */

async function checkArchive(): Promise<SpecialistHealth> {
  try {
    const lastSync = await kv.get<Record<string, unknown>>("archive:last_sync");
    const history = (await kv.get<Record<string, unknown>[]>("archive:sync_history")) ?? [];

    const lastRun = (lastSync?.timestamp as string) ?? (lastSync?.synced_at as string) ?? null;
    const rowsTotal = (lastSync?.rows_written as number) ?? history.length;
    const staleness = hoursAgo(lastRun);

    return {
      name: "ARCHIVE",
      status: statusFromStaleness(staleness),
      last_run: lastRun,
      last_success: lastRun,
      rows_total: rowsTotal,
      rows_last_24h: staleness < 24 ? rowsTotal : 0,
      staleness_hours: Math.round(staleness * 10) / 10,
    };
  } catch (err) {
    return {
      name: "ARCHIVE",
      status: "critical",
      last_run: null,
      last_success: null,
      rows_total: 0,
      rows_last_24h: 0,
      staleness_hours: Infinity,
      error_message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkForge(): Promise<SpecialistHealth> {
  try {
    const runs = (await kv.get<Record<string, unknown>[]>("forge:runs")) ?? [];
    const shipments = (await kv.get<Record<string, unknown>[]>("forge:shipments")) ?? [];

    const latestRun = latestTimestamp(runs, "updated_at") ?? latestTimestamp(runs, "created_at");
    const latestShipment = latestTimestamp(shipments, "updated_at") ?? latestTimestamp(shipments, "shipped_date");
    const lastRun = [latestRun, latestShipment].filter(Boolean).sort().pop() ?? null;

    const staleness = hoursAgo(lastRun);
    const recentRuns = countRecent(runs, "updated_at") + countRecent(runs, "created_at");
    const recentShipments = countRecent(shipments, "updated_at") + countRecent(shipments, "shipped_date");

    return {
      name: "FORGE",
      status: statusFromStaleness(staleness),
      last_run: lastRun,
      last_success: lastRun,
      rows_total: runs.length + shipments.length,
      rows_last_24h: recentRuns + recentShipments,
      staleness_hours: Math.round(staleness * 10) / 10,
    };
  } catch (err) {
    return {
      name: "FORGE",
      status: "critical",
      last_run: null,
      last_success: null,
      rows_total: 0,
      rows_last_24h: 0,
      staleness_hours: Infinity,
      error_message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkFreight(): Promise<SpecialistHealth> {
  try {
    const shipments = (await kv.get<Record<string, unknown>[]>("freight:shipments")) ?? [];

    const lastRun =
      latestTimestamp(shipments, "updated_at") ??
      latestTimestamp(shipments, "shipped_date") ??
      latestTimestamp(shipments, "created_at");
    const staleness = hoursAgo(lastRun);
    const recent = countRecent(shipments, "updated_at") + countRecent(shipments, "created_at");

    return {
      name: "FREIGHT",
      status: statusFromStaleness(staleness),
      last_run: lastRun,
      last_success: lastRun,
      rows_total: shipments.length,
      rows_last_24h: recent,
      staleness_hours: Math.round(staleness * 10) / 10,
    };
  } catch (err) {
    return {
      name: "FREIGHT",
      status: "critical",
      last_run: null,
      last_success: null,
      rows_total: 0,
      rows_last_24h: 0,
      staleness_hours: Infinity,
      error_message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkLedger(): Promise<SpecialistHealth> {
  try {
    const lastSync = await kv.get<Record<string, unknown>>("ledger:last_sync");

    const lastRun = (lastSync?.timestamp as string) ?? (lastSync?.synced_at as string) ?? null;
    const rowsTotal = (lastSync?.rows_written as number) ?? 0;
    const staleness = hoursAgo(lastRun);

    return {
      name: "LEDGER",
      status: statusFromStaleness(staleness),
      last_run: lastRun,
      last_success: lastRun,
      rows_total: rowsTotal,
      rows_last_24h: staleness < 24 ? rowsTotal : 0,
      staleness_hours: Math.round(staleness * 10) / 10,
    };
  } catch (err) {
    return {
      name: "LEDGER",
      status: "critical",
      last_run: null,
      last_success: null,
      rows_total: 0,
      rows_last_24h: 0,
      staleness_hours: Infinity,
      error_message: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export async function checkFleetHealth(): Promise<FleetHealth> {
  const specialists = await Promise.all([
    checkArchive(),
    checkForge(),
    checkFreight(),
    checkLedger(),
  ]);

  const alerts: string[] = [];
  for (const s of specialists) {
    if (s.status === "warning") {
      alerts.push(`${s.name} hasn't updated in ${s.staleness_hours} hours`);
    } else if (s.status === "critical" && s.staleness_hours === Infinity) {
      alerts.push(`${s.name} has never synced`);
    } else if (s.status === "critical") {
      alerts.push(
        `${s.name} is critically stale (${s.staleness_hours}h since last update)`,
      );
    }
    if (s.error_message) {
      alerts.push(`${s.name} error: ${s.error_message}`);
    }
  }

  return {
    timestamp: new Date().toISOString(),
    overall_status: worstStatus(specialists.map((s) => s.status)),
    specialists,
    alerts,
  };
}

export function generateFleetReport(health: FleetHealth): string {
  const date = new Date(health.timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  });

  const lines: string[] = [
    `\ud83c\udfe5 Fleet Health Report \u2014 ${date}`,
    "",
  ];

  for (const s of health.specialists) {
    const icon = STATUS_ICON[s.status];
    const label = STATUS_LABEL[s.status];
    let detail: string;

    if (s.status === "unknown") {
      detail = "never synced";
    } else if (s.staleness_hours < 1) {
      detail = `last sync: <1h ago, ${s.rows_total} rows`;
    } else {
      detail = `last sync: ${Math.round(s.staleness_hours)}h ago, ${s.rows_total} rows`;
    }

    const padded = s.name.padEnd(10);
    lines.push(`${padded} ${icon} ${label}  (${detail})`);
  }

  if (health.alerts.length > 0) {
    lines.push("");
    lines.push("\ud83d\udea8 Alerts:");
    for (const a of health.alerts) {
      lines.push(`- ${a}`);
    }
  }

  return lines.join("\n");
}

export async function storeHealthSnapshot(
  health: FleetHealth,
): Promise<void> {
  const MAX_HISTORY = 90; // keep ~90 snapshots
  const existing =
    (await kv.get<FleetHealth[]>("pulse:history")) ?? [];
  existing.push(health);
  // Trim to most recent entries
  const trimmed =
    existing.length > MAX_HISTORY
      ? existing.slice(existing.length - MAX_HISTORY)
      : existing;
  await kv.set("pulse:history", trimmed);
}

export async function getHistoricalHealth(
  days: number,
): Promise<FleetHealth[]> {
  const history =
    (await kv.get<FleetHealth[]>("pulse:history")) ?? [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return history.filter((h) => new Date(h.timestamp).getTime() >= cutoff);
}
