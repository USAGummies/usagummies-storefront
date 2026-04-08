/**
 * PIPELINE — Sales CRM & Follow-Up Engine for USA Gummies
 *
 * Tracks wholesale prospects from first touch to PO. Enforces follow-up
 * cadence, logs every touch, scores leads, prevents double-outreach,
 * and auto-schedules follow-ups when SENTINEL detects replies.
 *
 * Follow-up cadence:
 *   Day 0:  Initial outreach
 *   Day 3:  Follow-up #1 — "checking in" + sell sheet
 *   Day 7:  Follow-up #2 — value-add (market data, local angle)
 *   Day 14: Follow-up #3 — final touch with urgency
 *   Day 30: Re-engagement or archive
 *   Hot leads: daily touches until resolved
 *   Sample recipients: 7-day post-delivery check-in
 *
 * STORAGE: Prospects use Redis hash (HSET/HGET/HGETALL) keyed by prospect ID.
 * This eliminates read-modify-write race conditions during bulk loads.
 * Touches use a Redis list (LPUSH/LRANGE) for atomic appends.
 *
 * Data persisted in Vercel KV under pipeline:* keys.
 */

import { kv } from "@vercel/kv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProspectStatus =
  | "New"
  | "Contacted"
  | "Replied"
  | "Warm"
  | "Hot"
  | "Sample Sent"
  | "Quoted"
  | "Won"
  | "Dead"
  | "Archived";

export type ChannelType =
  | "gift_shop"
  | "hardware"
  | "distributor"
  | "chain"
  | "resort"
  | "museum"
  | "zoo"
  | "airport"
  | "military"
  | "grocery"
  | "convenience"
  | "online"
  | "other";

export type TouchType = "email" | "call" | "sample" | "quote" | "meeting" | "reply_received" | "other";

export type NextAction = "email" | "call" | "sample" | "quote" | "follow_up" | "wait" | "archive";

export type Region = "PNW" | "Mountain West" | "Southwest" | "Southeast" | "Northeast" | "Midwest" | "National";

export interface Prospect {
  id: string;
  company: string;
  contact_name: string;
  email: string;
  phone?: string;
  channel_type: ChannelType;
  region: Region;
  status: ProspectStatus;
  lead_score: number; // 0-100, computed
  last_contact_date: string | null; // ISO date
  touch_count: number;
  next_follow_up_date: string | null; // ISO date
  next_action: NextAction;
  revenue_potential: number; // estimated annual units
  sample_sent_date?: string;
  sample_tracking?: string;
  source?: string; // "Souvenir Shelf", "Faire", "inbound", etc.
  notion_page_id?: string; // link to Notion B2B Prospects DB
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface TouchRecord {
  id: string;
  prospect_id: string;
  type: TouchType;
  date: string; // ISO datetime
  subject?: string;
  summary: string;
  direction: "outbound" | "inbound";
  channel?: string; // "Gmail", "Slack", "phone"
  follow_up_scheduled?: string; // ISO date for next follow-up
  created_at: string;
}

// ---------------------------------------------------------------------------
// KV Keys
// ---------------------------------------------------------------------------

// Prospects: Redis hash — each field is prospect.id → JSON string
const KV_PROSPECTS_HASH = "pipeline:prospects:h";
// Touches: still a single key (append-only, no concurrent bulk loads)
const KV_TOUCHES = "pipeline:touches";

// ---------------------------------------------------------------------------
// Prospect hash helpers (atomic per-prospect writes)
// ---------------------------------------------------------------------------

/** Get all prospects from the hash map. Returns array. */
async function getAllProspects(): Promise<Prospect[]> {
  const hash = await kv.hgetall<Record<string, Prospect>>(KV_PROSPECTS_HASH);
  if (!hash) return [];
  return Object.values(hash);
}

/** Get a single prospect by ID. */
async function getProspectById(id: string): Promise<Prospect | null> {
  const p = await kv.hget<Prospect>(KV_PROSPECTS_HASH, id);
  return p || null;
}

/** Atomically write a single prospect. No read-modify-write on the collection. */
async function setProspect(prospect: Prospect): Promise<void> {
  await kv.hset(KV_PROSPECTS_HASH, { [prospect.id]: prospect });
}

// ---------------------------------------------------------------------------
// Follow-up cadence logic
// ---------------------------------------------------------------------------

const FOLLOW_UP_DAYS: Record<string, number[]> = {
  standard: [3, 7, 14, 30],
  hot: [1, 1, 1, 1, 1], // daily
  sample: [7], // 7 days post-delivery
};

function computeNextFollowUp(
  status: ProspectStatus,
  touchCount: number,
  lastContactDate: string | null,
  sampleSentDate?: string,
): string | null {
  if (["Won", "Dead", "Archived"].includes(status)) return null;

  const now = new Date();

  // Sample recipients: 7 days post-send
  if (status === "Sample Sent" && sampleSentDate) {
    const sampleDate = new Date(sampleSentDate);
    const followUp = new Date(sampleDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    return followUp.toISOString().split("T")[0];
  }

  // Hot leads: daily
  if (status === "Hot") {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return tomorrow.toISOString().split("T")[0];
  }

  // Standard cadence
  if (!lastContactDate) return now.toISOString().split("T")[0]; // Due now

  const lastContact = new Date(lastContactDate);
  const cadence = FOLLOW_UP_DAYS.standard;
  const cadenceIdx = Math.min(touchCount, cadence.length - 1);
  const daysUntilNext = cadence[cadenceIdx];
  const followUp = new Date(lastContact.getTime() + daysUntilNext * 24 * 60 * 60 * 1000);

  return followUp.toISOString().split("T")[0];
}

function computeLeadScore(prospect: Prospect): number {
  let score = 20; // base score

  // Status scoring
  const statusScores: Record<string, number> = {
    Hot: 40, Warm: 30, Replied: 25, "Sample Sent": 20, Quoted: 35,
    Contacted: 10, New: 5, Won: 50, Dead: 0, Archived: 0,
  };
  score += statusScores[prospect.status] || 0;

  // Revenue potential
  if (prospect.revenue_potential > 5000) score += 15;
  else if (prospect.revenue_potential > 1000) score += 10;
  else if (prospect.revenue_potential > 500) score += 5;

  // Recency — penalize stale leads
  if (prospect.last_contact_date) {
    const daysSince = (Date.now() - new Date(prospect.last_contact_date).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 30) score -= 15;
    else if (daysSince > 14) score -= 5;
  }

  // Touch count — engaged leads score higher
  if (prospect.touch_count >= 3) score += 5;

  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Prospects CRUD
// ---------------------------------------------------------------------------

export async function listProspects(
  filters?: {
    status?: ProspectStatus;
    channel_type?: ChannelType;
    region?: Region;
    min_score?: number;
    limit?: number;
  }
): Promise<Prospect[]> {
  let all = await getAllProspects();
  if (filters?.status) all = all.filter((p) => p.status === filters.status);
  if (filters?.channel_type) all = all.filter((p) => p.channel_type === filters.channel_type);
  if (filters?.region) all = all.filter((p) => p.region === filters.region);
  if (filters?.min_score) all = all.filter((p) => p.lead_score >= (filters.min_score || 0));

  // Sort by lead_score descending
  all.sort((a, b) => b.lead_score - a.lead_score);
  return all.slice(0, filters?.limit || 500);
}

export async function getProspect(id: string): Promise<Prospect | null> {
  return getProspectById(id);
}

export async function upsertProspect(
  input: Omit<Prospect, "created_at" | "updated_at" | "lead_score"> & { created_at?: string; lead_score?: number }
): Promise<Prospect> {
  const now = new Date().toISOString();
  const existing = await getProspectById(input.id);

  // Auto-compute follow-up and score
  const nextFollowUp = input.next_follow_up_date ||
    computeNextFollowUp(input.status, input.touch_count, input.last_contact_date, input.sample_sent_date);

  const prospect: Prospect = {
    ...input,
    next_follow_up_date: nextFollowUp,
    lead_score: 0, // computed below
    created_at: existing ? existing.created_at : (input.created_at || now),
    updated_at: now,
  };

  prospect.lead_score = computeLeadScore(prospect);

  // Atomic write — only touches this prospect's hash field
  await setProspect(prospect);
  return prospect;
}

export async function deleteProspect(id: string): Promise<{ deleted: boolean }> {
  const existing = await getProspectById(id);
  if (!existing) return { deleted: false };
  await kv.hdel(KV_PROSPECTS_HASH, id);
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Contact Dedup Check (OUTREACH DEDUP)
// ---------------------------------------------------------------------------

export async function checkContact(query: {
  company?: string;
  email?: string;
}): Promise<{ exists: boolean; prospect?: Prospect; touches: TouchRecord[] }> {
  const all = await getAllProspects();
  const touches = (await kv.get<TouchRecord[]>(KV_TOUCHES)) || [];

  let match: Prospect | undefined;

  if (query.email) {
    const email = query.email.toLowerCase();
    match = all.find((p) => p.email.toLowerCase() === email);
  }

  if (!match && query.company) {
    const company = query.company.toLowerCase();
    match = all.find((p) => p.company.toLowerCase().includes(company));
  }

  if (!match) return { exists: false, touches: [] };

  const prospectTouches = touches.filter((t) => t.prospect_id === match!.id);
  return { exists: true, prospect: match, touches: prospectTouches };
}

// ---------------------------------------------------------------------------
// Touch Logging
// ---------------------------------------------------------------------------

export async function logTouch(input: Omit<TouchRecord, "created_at"> & { created_at?: string }): Promise<{
  touch: TouchRecord;
  prospect: Prospect | null;
}> {
  const touches = (await kv.get<TouchRecord[]>(KV_TOUCHES)) || [];
  const now = new Date().toISOString();

  const touch: TouchRecord = {
    ...input,
    created_at: input.created_at || now,
  };

  touches.push(touch);
  if (touches.length > 5000) touches.splice(0, touches.length - 5000);
  await kv.set(KV_TOUCHES, touches);

  // Auto-update prospect (atomic read-modify-write on single prospect)
  const p = await getProspectById(input.prospect_id);
  let updatedProspect: Prospect | null = null;

  if (p) {
    p.touch_count++;
    p.last_contact_date = input.date.split("T")[0];
    p.updated_at = now;

    // Auto-status transitions
    if (input.type === "reply_received" && ["Contacted", "New"].includes(p.status)) {
      p.status = "Replied";
    }
    if (input.type === "sample" && !["Won", "Dead"].includes(p.status)) {
      p.status = "Sample Sent";
      p.sample_sent_date = input.date.split("T")[0];
    }

    // Recompute follow-up and score
    p.next_follow_up_date = input.follow_up_scheduled ||
      computeNextFollowUp(p.status, p.touch_count, p.last_contact_date, p.sample_sent_date);
    p.lead_score = computeLeadScore(p);

    if (input.follow_up_scheduled) {
      p.next_action = "follow_up";
    }

    await setProspect(p);
    updatedProspect = p;
  }

  return { touch, prospect: updatedProspect };
}

export async function getTouches(
  filters?: { prospect_id?: string; type?: TouchType; limit?: number }
): Promise<TouchRecord[]> {
  const all = (await kv.get<TouchRecord[]>(KV_TOUCHES)) || [];
  let filtered = all;
  if (filters?.prospect_id) filtered = filtered.filter((t) => t.prospect_id === filters.prospect_id);
  if (filters?.type) filtered = filtered.filter((t) => t.type === filters.type);
  return filtered.slice(-(filters?.limit || 200));
}

// ---------------------------------------------------------------------------
// Due Follow-ups
// ---------------------------------------------------------------------------

export async function getDueFollowups(
  filters?: { channel_type?: ChannelType; include_overdue?: boolean }
): Promise<Prospect[]> {
  const all = await getAllProspects();
  const today = new Date().toISOString().split("T")[0];

  let due = all.filter((p) => {
    if (["Won", "Dead", "Archived"].includes(p.status)) return false;
    if (!p.next_follow_up_date) return false;
    return p.next_follow_up_date <= today;
  });

  if (filters?.channel_type) {
    due = due.filter((p) => p.channel_type === filters.channel_type);
  }

  // Sort: overdue first (oldest date), then by lead score
  due.sort((a, b) => {
    if (a.next_follow_up_date! < b.next_follow_up_date!) return -1;
    if (a.next_follow_up_date! > b.next_follow_up_date!) return 1;
    return b.lead_score - a.lead_score;
  });

  return due;
}

// ---------------------------------------------------------------------------
// Pipeline Scorecard
// ---------------------------------------------------------------------------

export interface PipelineScorecard {
  total_prospects: number;
  by_status: Record<string, number>;
  by_channel_type: Record<string, number>;
  by_region: Record<string, number>;
  conversion_rates: {
    contacted_to_replied: number;
    replied_to_warm: number;
    warm_to_won: number;
    overall: number;
  };
  overdue_followups: number;
  due_today: number;
  avg_lead_score: number;
  total_revenue_potential: number;
  hot_leads: number;
  samples_pending: number;
  generated_at: string;
}

// ---------------------------------------------------------------------------
// SENTINEL → PIPELINE Write-back
// ---------------------------------------------------------------------------

/**
 * Called by Viktor when SENTINEL detects a reply in Gmail.
 * Looks up the prospect by email, logs the reply as a touch,
 * auto-transitions status, and recomputes follow-up date.
 *
 * Returns { matched, prospect, touch } or { matched: false } if no prospect found.
 */
export async function handleReplyDetected(input: {
  from_email: string;
  from_name?: string;
  subject: string;
  snippet?: string;
  date: string; // ISO datetime or RFC 2822 (e.g. "Wed, 08 Apr 2026 18:58:22 +0000")
  gmail_message_id?: string;
}): Promise<{
  matched: boolean;
  prospect?: Prospect;
  touch?: TouchRecord;
  action_taken?: string;
}> {
  // Normalize date — handle RFC 2822 ("Wed, 08 Apr 2026 ...") and ISO
  let normalizedDate = input.date;
  try {
    const parsed = new Date(input.date);
    if (!isNaN(parsed.getTime())) {
      normalizedDate = parsed.toISOString();
    }
  } catch { /* keep original */ }

  const all = await getAllProspects();
  const email = input.from_email.toLowerCase();

  // Match by email
  let match = all.find((p) => p.email.toLowerCase() === email);

  // Fallback: match by from_name against company
  if (!match && input.from_name) {
    const name = input.from_name.toLowerCase();
    match = all.find(
      (p) =>
        p.company.toLowerCase().includes(name) ||
        p.contact_name.toLowerCase().includes(name),
    );
  }

  if (!match) {
    return { matched: false };
  }

  // Log the reply as a touch
  const touchId = `touch-sentinel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { touch, prospect } = await logTouch({
    id: touchId,
    prospect_id: match.id,
    type: "reply_received",
    date: normalizedDate,
    subject: input.subject,
    summary: input.snippet
      ? `Reply detected by SENTINEL: "${input.snippet.slice(0, 200)}"`
      : `Reply detected by SENTINEL. Subject: ${input.subject}`,
    direction: "inbound",
    channel: "Gmail",
  });

  let actionTaken = `Logged reply from ${input.from_email}.`;
  if (prospect && prospect.status === "Replied") {
    actionTaken += " Status auto-transitioned to Replied.";
  }
  if (prospect) {
    actionTaken += ` Next follow-up: ${prospect.next_follow_up_date || "none"}.`;
  }

  return { matched: true, prospect: prospect || undefined, touch, action_taken: actionTaken };
}

// ---------------------------------------------------------------------------
// SAMPLE TRACKER — Auto Follow-up Creation
// ---------------------------------------------------------------------------

/**
 * Called when a sample is shipped. Links sample to prospect in PIPELINE,
 * auto-creates a follow-up touch scheduled for 7 days post-delivery.
 *
 * If delivery_date is not provided, estimates delivery as ship_date + 5 days.
 */
export async function trackSampleShipment(input: {
  prospect_id: string;
  tracking_number?: string;
  carrier?: string;
  ship_date: string; // ISO date
  estimated_delivery_date?: string; // ISO date
  units: number;
  notes?: string;
}): Promise<{
  prospect: Prospect | null;
  touch: TouchRecord;
  follow_up_date: string;
}> {
  // Estimate delivery: ship_date + 5 business days if not provided
  const deliveryDate = input.estimated_delivery_date ||
    new Date(new Date(input.ship_date).getTime() + 5 * 24 * 60 * 60 * 1000)
      .toISOString().split("T")[0];

  // Follow-up = 7 days after estimated delivery
  const followUpDate = new Date(
    new Date(deliveryDate).getTime() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString().split("T")[0];

  // Log sample touch with scheduled follow-up
  const touchId = `touch-sample-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const summary = [
    `Sample shipped: ${input.units} units`,
    input.carrier ? `via ${input.carrier}` : null,
    input.tracking_number ? `(${input.tracking_number})` : null,
    `Est. delivery: ${deliveryDate}`,
    input.notes || null,
  ].filter(Boolean).join(". ");

  const { touch, prospect } = await logTouch({
    id: touchId,
    prospect_id: input.prospect_id,
    type: "sample",
    date: input.ship_date,
    subject: "Sample Shipment",
    summary,
    direction: "outbound",
    channel: input.carrier || "Pirate Ship",
    follow_up_scheduled: followUpDate,
  });

  // Also update prospect with tracking info (atomic single-prospect write)
  const p = await getProspectById(input.prospect_id);
  if (p) {
    p.sample_tracking = input.tracking_number;
    p.sample_sent_date = input.ship_date;
    await setProspect(p);
  }

  return { prospect: prospect || p, touch, follow_up_date: followUpDate };
}

/**
 * Get all prospects with samples awaiting follow-up (shipped but follow-up not yet done).
 */
export async function getSampleFollowupsDue(): Promise<Prospect[]> {
  const all = await getAllProspects();
  const today = new Date().toISOString().split("T")[0];

  return all.filter((p) => {
    if (p.status !== "Sample Sent") return false;
    if (!p.next_follow_up_date) return false;
    return p.next_follow_up_date <= today;
  }).sort((a, b) => {
    // Oldest due first
    if (a.next_follow_up_date! < b.next_follow_up_date!) return -1;
    if (a.next_follow_up_date! > b.next_follow_up_date!) return 1;
    return b.lead_score - a.lead_score;
  });
}

// ---------------------------------------------------------------------------
// Pipeline Scorecard
// ---------------------------------------------------------------------------

export async function getScorecard(): Promise<PipelineScorecard> {
  const all = await getAllProspects();
  const today = new Date().toISOString().split("T")[0];

  const byStatus: Record<string, number> = {};
  const byChannelType: Record<string, number> = {};
  const byRegion: Record<string, number> = {};
  let totalScore = 0;
  let totalRevPotential = 0;
  let overdue = 0;
  let dueToday = 0;
  let hotLeads = 0;
  let samplesPending = 0;

  for (const p of all) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    byChannelType[p.channel_type] = (byChannelType[p.channel_type] || 0) + 1;
    byRegion[p.region] = (byRegion[p.region] || 0) + 1;
    totalScore += p.lead_score;
    totalRevPotential += p.revenue_potential;

    if (p.status === "Hot") hotLeads++;
    if (p.status === "Sample Sent") samplesPending++;

    if (p.next_follow_up_date && !["Won", "Dead", "Archived"].includes(p.status)) {
      if (p.next_follow_up_date < today) overdue++;
      else if (p.next_follow_up_date === today) dueToday++;
    }
  }

  const contacted = (byStatus["Contacted"] || 0) + (byStatus["Replied"] || 0) + (byStatus["Warm"] || 0) + (byStatus["Hot"] || 0) + (byStatus["Sample Sent"] || 0) + (byStatus["Quoted"] || 0) + (byStatus["Won"] || 0);
  const replied = (byStatus["Replied"] || 0) + (byStatus["Warm"] || 0) + (byStatus["Hot"] || 0) + (byStatus["Won"] || 0);
  const warm = (byStatus["Warm"] || 0) + (byStatus["Hot"] || 0) + (byStatus["Won"] || 0);
  const won = byStatus["Won"] || 0;

  return {
    total_prospects: all.length,
    by_status: byStatus,
    by_channel_type: byChannelType,
    by_region: byRegion,
    conversion_rates: {
      contacted_to_replied: contacted > 0 ? Math.round((replied / contacted) * 100) : 0,
      replied_to_warm: replied > 0 ? Math.round((warm / replied) * 100) : 0,
      warm_to_won: warm > 0 ? Math.round((won / warm) * 100) : 0,
      overall: all.length > 0 ? Math.round((won / all.length) * 100) : 0,
    },
    overdue_followups: overdue,
    due_today: dueToday,
    avg_lead_score: all.length > 0 ? Math.round(totalScore / all.length) : 0,
    total_revenue_potential: totalRevPotential,
    hot_leads: hotLeads,
    samples_pending: samplesPending,
    generated_at: new Date().toISOString(),
  };
}
