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

const KV_PROSPECTS = "pipeline:prospects";
const KV_TOUCHES = "pipeline:touches";

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
  const all = (await kv.get<Prospect[]>(KV_PROSPECTS)) || [];
  let filtered = all;
  if (filters?.status) filtered = filtered.filter((p) => p.status === filters.status);
  if (filters?.channel_type) filtered = filtered.filter((p) => p.channel_type === filters.channel_type);
  if (filters?.region) filtered = filtered.filter((p) => p.region === filters.region);
  if (filters?.min_score) filtered = filtered.filter((p) => p.lead_score >= (filters.min_score || 0));

  // Sort by lead_score descending
  filtered.sort((a, b) => b.lead_score - a.lead_score);
  return filtered.slice(0, filters?.limit || 500);
}

export async function getProspect(id: string): Promise<Prospect | null> {
  const all = (await kv.get<Prospect[]>(KV_PROSPECTS)) || [];
  return all.find((p) => p.id === id) || null;
}

export async function upsertProspect(
  input: Omit<Prospect, "created_at" | "updated_at" | "lead_score"> & { created_at?: string; lead_score?: number }
): Promise<Prospect> {
  const all = (await kv.get<Prospect[]>(KV_PROSPECTS)) || [];
  const now = new Date().toISOString();
  const idx = all.findIndex((p) => p.id === input.id);

  // Auto-compute follow-up and score
  const nextFollowUp = input.next_follow_up_date ||
    computeNextFollowUp(input.status, input.touch_count, input.last_contact_date, input.sample_sent_date);

  const prospect: Prospect = {
    ...input,
    next_follow_up_date: nextFollowUp,
    lead_score: 0, // computed below
    created_at: idx >= 0 ? all[idx].created_at : (input.created_at || now),
    updated_at: now,
  };

  prospect.lead_score = computeLeadScore(prospect);

  if (idx >= 0) {
    all[idx] = prospect;
  } else {
    all.push(prospect);
  }

  if (all.length > 2000) all.splice(0, all.length - 2000);
  await kv.set(KV_PROSPECTS, all);
  return prospect;
}

// ---------------------------------------------------------------------------
// Contact Dedup Check (OUTREACH DEDUP)
// ---------------------------------------------------------------------------

export async function checkContact(query: {
  company?: string;
  email?: string;
}): Promise<{ exists: boolean; prospect?: Prospect; touches: TouchRecord[] }> {
  const all = (await kv.get<Prospect[]>(KV_PROSPECTS)) || [];
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

  // Auto-update prospect
  const prospects = (await kv.get<Prospect[]>(KV_PROSPECTS)) || [];
  const pIdx = prospects.findIndex((p) => p.id === input.prospect_id);

  let updatedProspect: Prospect | null = null;

  if (pIdx >= 0) {
    const p = prospects[pIdx];
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

    prospects[pIdx] = p;
    await kv.set(KV_PROSPECTS, prospects);
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
  const all = (await kv.get<Prospect[]>(KV_PROSPECTS)) || [];
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

export async function getScorecard(): Promise<PipelineScorecard> {
  const all = (await kv.get<Prospect[]>(KV_PROSPECTS)) || [];
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
