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
