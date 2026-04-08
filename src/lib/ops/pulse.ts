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
    const decisions = (await kv.get<Record<string, unknown>[]>("ledger:decisions")) ?? [];
    const questions = (await kv.get<Record<string, unknown>[]>("ledger:pending_questions")) ?? [];
    const entries = (await kv.get<Record<string, unknown>[]>("ledger:entries")) ?? [];

    const lastDecision = latestTimestamp(decisions, "updated_at");
    const lastQuestion = latestTimestamp(questions, "asked_at");
    const lastEntry = latestTimestamp(entries, "created_at");
    const lastRun = [lastDecision, lastQuestion, lastEntry].filter(Boolean).sort().pop() ?? null;

    const staleness = hoursAgo(lastRun);

    return {
      name: "LEDGER",
      status: statusFromStaleness(staleness),
      last_run: lastRun,
      last_success: lastRun,
      rows_total: decisions.length + questions.length + entries.length,
      rows_last_24h: countRecent(decisions, "updated_at") + countRecent(entries, "created_at"),
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

async function checkInventory(): Promise<SpecialistHealth> {
  try {
    const batches = (await kv.get<Record<string, unknown>[]>("inventory:batches")) ?? [];
    const locations = (await kv.get<Record<string, unknown>[]>("inventory:locations")) ?? [];

    const lastBatch = latestTimestamp(batches, "updated_at") ?? latestTimestamp(batches, "created_at");
    const lastLoc = latestTimestamp(locations, "last_updated");
    const lastRun = [lastBatch, lastLoc].filter(Boolean).sort().pop() ?? null;

    const staleness = hoursAgo(lastRun);

    return {
      name: "INVENTORY",
      status: statusFromStaleness(staleness),
      last_run: lastRun,
      last_success: lastRun,
      rows_total: batches.length + locations.length,
      rows_last_24h: countRecent(batches, "updated_at"),
      staleness_hours: Math.round(staleness * 10) / 10,
    };
  } catch (err) {
    return {
      name: "INVENTORY",
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

async function checkOrderDesk(): Promise<SpecialistHealth> {
  try {
    const orders = (await kv.get<Record<string, unknown>[]>("orders:log")) ?? [];
    const fulfillments = (await kv.get<Record<string, unknown>[]>("orders:fulfillments")) ?? [];

    const lastOrder = latestTimestamp(orders, "updated_at") ?? latestTimestamp(orders, "created_at");
    const lastFulfill = latestTimestamp(fulfillments, "created_at");
    const lastRun = [lastOrder, lastFulfill].filter(Boolean).sort().pop() ?? null;

    const staleness = hoursAgo(lastRun);

    return {
      name: "ORDER DESK",
      status: statusFromStaleness(staleness),
      last_run: lastRun,
      last_success: lastRun,
      rows_total: orders.length + fulfillments.length,
      rows_last_24h: countRecent(orders, "updated_at") + countRecent(fulfillments, "created_at"),
      staleness_hours: Math.round(staleness * 10) / 10,
    };
  } catch (err) {
    return {
      name: "ORDER DESK",
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
    checkInventory(),
    checkOrderDesk(),
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

/* ------------------------------------------------------------------ */
/*  COMMITMENTS TRACKER                                                */
/* ------------------------------------------------------------------ */

export type CommitmentStatus = "committed" | "in_progress" | "completed" | "missed" | "withdrawn";

export interface Commitment {
  id: string;
  owner: string; // who committed (e.g. "Viktor", "Ben")
  description: string;
  deadline?: string; // ISO date
  source_channel?: string;
  source_thread?: string;
  status: CommitmentStatus;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  notes?: string;
}

const KV_COMMITMENTS = "pulse:commitments";

export async function listCommitments(
  filters?: { owner?: string; status?: CommitmentStatus }
): Promise<Commitment[]> {
  const all = (await kv.get<Commitment[]>(KV_COMMITMENTS)) || [];
  let filtered = all;
  if (filters?.owner) {
    const o = filters.owner.toLowerCase();
    filtered = filtered.filter((c) => c.owner.toLowerCase().includes(o));
  }
  if (filters?.status) {
    filtered = filtered.filter((c) => c.status === filters.status);
  }
  return filtered;
}

export async function upsertCommitment(
  input: Omit<Commitment, "created_at" | "updated_at"> & { created_at?: string; updated_at?: string }
): Promise<Commitment> {
  const all = (await kv.get<Commitment[]>(KV_COMMITMENTS)) || [];
  const now = new Date().toISOString();
  const idx = all.findIndex((c) => c.id === input.id);

  const commitment: Commitment = {
    ...input,
    created_at: idx >= 0 ? all[idx].created_at : (input.created_at || now),
    updated_at: now,
  };

  if (idx >= 0) {
    all[idx] = commitment;
  } else {
    all.push(commitment);
  }

  if (all.length > 500) all.splice(0, all.length - 500);
  await kv.set(KV_COMMITMENTS, all);
  return commitment;
}

export async function completeCommitment(id: string): Promise<Commitment | null> {
  const all = (await kv.get<Commitment[]>(KV_COMMITMENTS)) || [];
  const idx = all.findIndex((c) => c.id === id);
  if (idx < 0) return null;

  all[idx].status = "completed";
  all[idx].completed_at = new Date().toISOString();
  all[idx].updated_at = new Date().toISOString();
  await kv.set(KV_COMMITMENTS, all);
  return all[idx];
}

/* ------------------------------------------------------------------ */
/*  ESCALATION ENGINE                                                  */
/* ------------------------------------------------------------------ */

export type EscalationType =
  | "stale_question"
  | "missed_commitment"
  | "stale_entry"
  | "stale_specialist"
  | "missing_coa_route";

export interface Escalation {
  type: EscalationType;
  severity: "info" | "warning" | "critical";
  message: string;
  target_person?: string; // who should act
  source_id?: string; // linked record ID
  age_hours: number;
}

export async function checkEscalations(): Promise<Escalation[]> {
  const escalations: Escalation[] = [];
  const now = Date.now();

  // 1. Check pending questions > 72 hours
  try {
    const questions = (await kv.get<Array<{
      id: string; question: string; asked_to: string; asked_at: string; status: string;
    }>>("ledger:pending_questions")) || [];

    for (const q of questions) {
      if (q.status !== "waiting") continue;
      const ageHrs = (now - new Date(q.asked_at).getTime()) / (1000 * 60 * 60);
      if (ageHrs > 72) {
        escalations.push({
          type: "stale_question",
          severity: "warning",
          message: `Pending question for ${q.asked_to}: "${q.question.slice(0, 80)}..." (${Math.round(ageHrs)}h old)`,
          target_person: q.asked_to,
          source_id: q.id,
          age_hours: Math.round(ageHrs),
        });
      }
    }
  } catch { /* ignore */ }

  // 2. Check missed commitments
  try {
    const commitments = (await kv.get<Commitment[]>(KV_COMMITMENTS)) || [];
    for (const c of commitments) {
      if (c.status !== "committed" && c.status !== "in_progress") continue;

      if (c.deadline) {
        const deadlineMs = new Date(c.deadline).getTime();
        if (now > deadlineMs) {
          const overHrs = (now - deadlineMs) / (1000 * 60 * 60);
          escalations.push({
            type: "missed_commitment",
            severity: overHrs > 48 ? "critical" : "warning",
            message: `${c.owner} committed to: "${c.description.slice(0, 80)}..." — deadline missed by ${Math.round(overHrs)}h`,
            target_person: c.owner,
            source_id: c.id,
            age_hours: Math.round(overHrs),
          });
        }
      } else {
        // No deadline — check if it's been sitting for > 48 hours
        const ageHrs = (now - new Date(c.created_at).getTime()) / (1000 * 60 * 60);
        if (ageHrs > 48) {
          escalations.push({
            type: "missed_commitment",
            severity: "info",
            message: `${c.owner} committed to: "${c.description.slice(0, 80)}..." — ${Math.round(ageHrs)}h ago, no deadline set, status: ${c.status}`,
            target_person: c.owner,
            source_id: c.id,
            age_hours: Math.round(ageHrs),
          });
        }
      }
    }
  } catch { /* ignore */ }

  // 3. Check LEDGER entries stuck in pending_review > 48 hours
  try {
    const entries = (await kv.get<Array<{
      id: string; description: string; status: string; created_at: string;
    }>>("ledger:entries")) || [];

    for (const e of entries) {
      if (e.status !== "pending_review") continue;
      const ageHrs = (now - new Date(e.created_at).getTime()) / (1000 * 60 * 60);
      if (ageHrs > 48) {
        escalations.push({
          type: "stale_entry",
          severity: "warning",
          message: `LEDGER entry pending review: "${e.description.slice(0, 80)}..." (${Math.round(ageHrs)}h waiting)`,
          target_person: "Rene",
          source_id: e.id,
          age_hours: Math.round(ageHrs),
        });
      }
    }
  } catch { /* ignore */ }

  // Sort by severity (critical first)
  const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  escalations.sort((a, b) => (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2));

  return escalations;
}

export async function generateEscalationReport(escalations: Escalation[]): Promise<string> {
  if (escalations.length === 0) return "🟢 No escalations — all clear.";

  const icons = { critical: "🔴", warning: "🟡", info: "🔵" };
  const lines = ["🚨 Escalation Report", ""];

  for (const e of escalations) {
    lines.push(`${icons[e.severity]} [${e.type}] ${e.message}`);
  }

  const critical = escalations.filter((e) => e.severity === "critical").length;
  const warning = escalations.filter((e) => e.severity === "warning").length;
  lines.push("", `Summary: ${critical} critical, ${warning} warnings, ${escalations.length} total`);

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Health Snapshot Storage                                            */
/* ------------------------------------------------------------------ */

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
