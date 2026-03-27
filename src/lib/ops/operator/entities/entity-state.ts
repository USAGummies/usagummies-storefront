import { readState, writeState } from "@/lib/ops/state";

export interface EntityState {
  name: string;
  type: "vendor" | "customer" | "partner" | "broker" | "investor";
  last_contact_date: string | null;
  last_contact_channel: "email" | "slack" | "phone" | "in_person" | null;
  last_contact_summary: string | null;
  open_items: Array<{
    description: string;
    due_date: string | null;
    priority: "high" | "medium" | "low";
  }>;
  next_action: string | null;
  next_action_date: string | null;
  relationship_status: "active" | "pending" | "stale" | "cold" | "new";
  notes: string[];
}

export const ENTITY_STATE_KEY = "operator:entity_states" as never;

export type EntityEvent = {
  type: string;
  summary: string;
  date: string;
  channel?: EntityState["last_contact_channel"] | null;
  entity_type?: EntityState["type"];
  allowCreate?: boolean;
  next_action?: string | null;
  next_action_date?: string | null;
  note?: string | null;
  open_item?: EntityState["open_items"][number] | null;
};

const INITIAL_ENTITY_STATES: EntityState[] = [
  {
    name: "Powers Confections",
    type: "vendor",
    last_contact_date: "2026-03-26",
    last_contact_channel: "in_person",
    last_contact_summary: "Powers meeting held March 26; co-packing scope and production timing active.",
    open_items: [
      { description: "Lock co-packing rate and production start date", due_date: null, priority: "high" },
      { description: "Confirm shelf life and film compatibility", due_date: null, priority: "medium" },
    ],
    next_action: "Follow up on meeting decisions and commercial terms.",
    next_action_date: "2026-03-27",
    relationship_status: "active",
    notes: ["Primary co-packer candidate.", "Meeting prep and follow-up should stay current."],
  },
  {
    name: "Albanese Confectionery",
    type: "vendor",
    last_contact_date: "2026-03-18",
    last_contact_channel: "email",
    last_contact_summary: "Waiting on freight quote and supply inputs.",
    open_items: [
      { description: "Freight quote outstanding", due_date: null, priority: "high" },
    ],
    next_action: "Follow up on freight quote.",
    next_action_date: "2026-03-27",
    relationship_status: "pending",
    notes: ["Ingredient/gummy base supplier."],
  },
  {
    name: "Belmark",
    type: "vendor",
    last_contact_date: "2026-03-20",
    last_contact_channel: "email",
    last_contact_summary: "Film supplier relationship active.",
    open_items: [
      { description: "Confirm film timing with production plan", due_date: null, priority: "medium" },
    ],
    next_action: "Confirm film timing versus Powers run.",
    next_action_date: "2026-03-28",
    relationship_status: "active",
    notes: ["Film supplier."],
  },
  {
    name: "Inderbitzin Distributors",
    type: "customer",
    last_contact_date: "2026-03-25",
    last_contact_channel: "email",
    last_contact_summary: "Active PO #009180 for April 1 delivery.",
    open_items: [
      { description: "Prepare invoice and shipping cost for PO #009180", due_date: "2026-04-01", priority: "high" },
    ],
    next_action: "Hold draft invoice until April 1 send instruction.",
    next_action_date: "2026-04-01",
    relationship_status: "active",
    notes: ["Current active wholesale customer.", "Committed quantity tied to April 1 delivery."],
  },
  {
    name: "Reid Mitchell",
    type: "broker",
    last_contact_date: "2026-03-20",
    last_contact_channel: "email",
    last_contact_summary: "Broker thread is stale and needs follow-up.",
    open_items: [
      { description: "Follow up on broker thread", due_date: null, priority: "medium" },
    ],
    next_action: "Draft follow-up email.",
    next_action_date: "2026-03-27",
    relationship_status: "stale",
    notes: ["Pipeline relationship; not fully closed out."],
  },
  {
    name: "Rene Gonzalez",
    type: "investor",
    last_contact_date: "2026-03-26",
    last_contact_channel: "slack",
    last_contact_summary: "Finance operations active; investor loan tracking remains open.",
    open_items: [
      { description: "Keep investor loan and finance reporting current", due_date: null, priority: "high" },
    ],
    next_action: "Deliver compact finance brief and approvals.",
    next_action_date: "2026-03-27",
    relationship_status: "active",
    notes: ["Finance lead and investor."],
  },
  {
    name: "Mike Arlint",
    type: "customer",
    last_contact_date: "2026-03-24",
    last_contact_channel: "email",
    last_contact_summary: "New customer with PO 140812.",
    open_items: [
      { description: "Validate PO 140812 and next action", due_date: null, priority: "medium" },
    ],
    next_action: "Confirm PO details and next follow-up.",
    next_action_date: "2026-03-28",
    relationship_status: "new",
    notes: ["New customer opportunity."],
  },
];

export async function getEntityStates(): Promise<EntityState[]> {
  return readState<EntityState[]>(ENTITY_STATE_KEY, []);
}

export async function ensureEntityStatesInitialized(): Promise<EntityState[]> {
  const existing = await getEntityStates();
  if (Array.isArray(existing) && existing.length >= INITIAL_ENTITY_STATES.length) {
    return existing;
  }
  await writeState(ENTITY_STATE_KEY, INITIAL_ENTITY_STATES);
  return INITIAL_ENTITY_STATES;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

const ENTITY_ALIASES: Record<string, string[]> = {
  "Powers Confections": ["powers", "greg", "greg k", "greg kroetch", "powers confections", "powers foods"],
  "Albanese Confectionery": ["albanese", "bill", "bill albanese"],
  "Belmark": ["belmark", "jonathan"],
  "Inderbitzin Distributors": ["inderbitzin", "patrick", "patrick mcdonald", "interbitson"],
  "Reid Mitchell": ["reid", "reid mitchell"],
  "Rene Gonzalez": ["rene", "rene gonzalez"],
  "Mike Arlint": ["mike arlint", "arlint", "mike"],
};

function relationshipFromDays(days: number, current: EntityState["relationship_status"]): EntityState["relationship_status"] {
  if (days <= 3) return "active";
  if (days <= 7) return current === "new" ? "new" : "pending";
  if (days <= 14) return "stale";
  return "cold";
}

function normalizeEventDate(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

export function findEntityMatch(entityName: string, states: EntityState[]): EntityState | null {
  const needle = normalize(entityName);
  if (!needle) return null;
  let best: EntityState | null = null;
  let bestScore = 0;
  for (const state of states) {
    const names = [state.name, ...(ENTITY_ALIASES[state.name] || [])].map(normalize);
    for (const candidate of names) {
      if (!candidate) continue;
      let score = 0;
      if (candidate === needle) score = 1;
      else if (candidate.includes(needle) || needle.includes(candidate)) score = 0.8;
      else {
        const overlap = candidate.split(" ").filter((part) => needle.includes(part)).length;
        score = overlap >= 2 ? 0.65 : 0;
      }
      if (score > bestScore) {
        best = state;
        bestScore = score;
      }
    }
  }
  return bestScore >= 0.65 ? best : null;
}

export function extractEntityMentions(text: string): string[] {
  const haystack = normalize(text);
  const matches = new Set<string>();
  for (const [name, aliases] of Object.entries(ENTITY_ALIASES)) {
    for (const alias of [name, ...aliases]) {
      const normalizedAlias = normalize(alias);
      if (normalizedAlias && haystack.includes(normalizedAlias)) {
        matches.add(name);
      }
    }
  }
  return [...matches];
}

export async function updateEntityFromEvent(entityName: string, event: EntityEvent): Promise<EntityState | null> {
  const states = await ensureEntityStatesInitialized();
  const matched = findEntityMatch(entityName, states);
  if (!matched && !event.allowCreate) {
    return null;
  }
  const nextStates = [...states];
  const eventDate = normalizeEventDate(event.date);
  const eventAt = new Date(`${eventDate}T00:00:00Z`).getTime();
  const daysSince = Number.isFinite(eventAt)
    ? Math.max(0, Math.floor((Date.now() - eventAt) / (24 * 60 * 60 * 1000)))
    : 0;
  const idx = matched ? nextStates.findIndex((state) => state.name === matched.name) : -1;
  const previous: EntityState = idx >= 0
    ? nextStates[idx]
    : {
        name: entityName.trim() || "Unknown entity",
        type: event.entity_type || "partner",
        last_contact_date: null,
        last_contact_channel: null,
        last_contact_summary: null,
        open_items: [],
        next_action: null,
        next_action_date: null,
        relationship_status: "new",
        notes: [],
      };
  const openItems = event.open_item
    ? [...previous.open_items.filter((item) => item.description !== event.open_item?.description), event.open_item].slice(-8)
    : previous.open_items;
  const notes = event.note
    ? [...previous.notes, event.note].filter(Boolean).slice(-12)
    : previous.notes;
  const updated: EntityState = {
    ...previous,
    last_contact_date: eventDate,
    last_contact_channel: event.channel ?? previous.last_contact_channel,
    last_contact_summary: event.summary || previous.last_contact_summary,
    next_action: event.next_action ?? previous.next_action,
    next_action_date: event.next_action_date ?? previous.next_action_date,
    relationship_status: relationshipFromDays(daysSince, previous.relationship_status),
    open_items: openItems,
    notes,
  };
  if (idx >= 0) nextStates[idx] = updated;
  else nextStates.push(updated);
  await writeState(ENTITY_STATE_KEY, nextStates);
  return updated;
}
