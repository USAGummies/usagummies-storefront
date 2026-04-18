/**
 * HubSpot Client — USA Gummies
 *
 * Thin wrapper around HubSpot CRM v3 API for the wholesale order engine.
 * Used by the booth-order route to auto-create contacts + deals on the
 * B2B Wholesale pipeline whenever a customer submits an order.
 *
 * Auth: HUBSPOT_PRIVATE_APP_TOKEN env var (Private App with full CRM scopes).
 *
 * Pipeline: "B2B Wholesale" (id 1907159777)
 * Stages:
 *   Lead (3017533129) → Contacted (3017718461) → Responded (3017718462) →
 *   Sample Requested (3017718463) → Sample Shipped (3017718464) →
 *   Quote/PO Sent (3017718465) → Vendor Setup (3502336729) →
 *   PO Received (3017718466) → Shipped (3017718460) → Reorder (3485080311) →
 *   Closed Won (3502336730) → Closed Lost (3502659283) → On Hold (3502659284)
 *
 * Owner: Ben (id 87737986) — all wholesale deals assigned to him by default.
 */

const HUBSPOT_API = "https://api.hubapi.com";
const PIPELINE_B2B_WHOLESALE = "1907159777";
const STAGE_LEAD = "3017533129";
const STAGE_PO_RECEIVED = "3017718466";
const STAGE_SHIPPED = "3017718460";
const STAGE_CLOSED_WON = "3502336730";
const DEFAULT_OWNER_ID = "87737986"; // Ben Stutman

// Association type IDs (HUBSPOT_DEFINED)
const ASSOC_DEAL_TO_CONTACT = 3;
const ASSOC_CONTACT_TO_DEAL = 4;
const ASSOC_EMAIL_TO_CONTACT = 198;
const ASSOC_EMAIL_TO_DEAL = 210;
const ASSOC_NOTE_TO_CONTACT = 202;
const ASSOC_NOTE_TO_DEAL = 214;
const ASSOC_TASK_TO_CONTACT = 204;
const ASSOC_TASK_TO_DEAL = 216;

export const HUBSPOT = {
  PIPELINE_B2B_WHOLESALE,
  STAGE_LEAD,
  STAGE_PO_RECEIVED,
  STAGE_SHIPPED,
  STAGE_CLOSED_WON,
  DEFAULT_OWNER_ID,
  ASSOC_DEAL_TO_CONTACT,
  ASSOC_CONTACT_TO_DEAL,
  ASSOC_EMAIL_TO_CONTACT,
  ASSOC_EMAIL_TO_DEAL,
  ASSOC_NOTE_TO_CONTACT,
  ASSOC_NOTE_TO_DEAL,
  ASSOC_TASK_TO_CONTACT,
  ASSOC_TASK_TO_DEAL,
};

function getToken(): string | null {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN?.trim();
  return token || null;
}

export function isHubSpotConfigured(): boolean {
  return !!getToken();
}

type HSResponse<T = Record<string, unknown>> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
};

async function hsRequest<T = Record<string, unknown>>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<HSResponse<T>> {
  const token = getToken();
  if (!token) return { ok: false, status: 0, error: "HUBSPOT_PRIVATE_APP_TOKEN not set" };
  try {
    const res = await fetch(`${HUBSPOT_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: unknown = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = (data as { message?: string })?.message || `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: err, data: data as T };
    }
    return { ok: true, status: res.status, data: data as T };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export type ContactInput = {
  email: string;
  firstname?: string;
  lastname?: string;
  company?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  jobtitle?: string;
  lifecyclestage?: string;
  hs_lead_status?: string;
  /** Free-form notes field on the contact record */
  message?: string;
};

/**
 * Search for a contact by email. Returns the contact ID if found, null otherwise.
 */
export async function findContactByEmail(email: string): Promise<string | null> {
  const res = await hsRequest<{ results: { id: string }[] }>("POST", "/crm/v3/objects/contacts/search", {
    limit: 1,
    filterGroups: [
      {
        filters: [{ propertyName: "email", operator: "EQ", value: email.trim().toLowerCase() }],
      },
    ],
    properties: ["email"],
  });
  if (!res.ok || !res.data?.results?.length) return null;
  return res.data.results[0].id;
}

/**
 * Upsert a contact by email. If a contact with the given email already exists,
 * update its properties in place; otherwise create a new one. Returns the contact ID.
 *
 * Safe to call on every booth order submission — duplicate-safe.
 */
export async function upsertContactByEmail(input: ContactInput): Promise<{ id: string; created: boolean } | null> {
  const email = input.email.trim().toLowerCase();
  if (!email) return null;
  const existing = await findContactByEmail(email);

  const properties: Record<string, string> = { email };
  if (input.firstname) properties.firstname = input.firstname.trim();
  if (input.lastname) properties.lastname = input.lastname.trim();
  if (input.company) properties.company = input.company.trim();
  if (input.phone) properties.phone = input.phone.trim();
  if (input.address) properties.address = input.address.trim();
  if (input.city) properties.city = input.city.trim();
  if (input.state) properties.state = input.state.trim();
  if (input.zip) properties.zip = input.zip.trim();
  if (input.country) properties.country = input.country.trim();
  if (input.jobtitle) properties.jobtitle = input.jobtitle.trim();
  if (input.lifecyclestage) properties.lifecyclestage = input.lifecyclestage;
  if (input.hs_lead_status) properties.hs_lead_status = input.hs_lead_status;
  if (input.message) properties.message = input.message;
  properties.hubspot_owner_id = DEFAULT_OWNER_ID;

  if (existing) {
    const res = await hsRequest<{ id: string }>("PATCH", `/crm/v3/objects/contacts/${existing}`, {
      properties,
    });
    if (!res.ok) return null;
    return { id: existing, created: false };
  }
  const res = await hsRequest<{ id: string }>("POST", "/crm/v3/objects/contacts", { properties });
  if (!res.ok || !res.data?.id) return null;
  return { id: res.data.id, created: true };
}

export type DealInput = {
  dealname: string;
  amount?: number | string;
  /** Pipeline ID. Defaults to B2B Wholesale. */
  pipeline?: string;
  /** Stage ID. Defaults to PO Received for booth orders. */
  dealstage?: string;
  /** Close date as ISO YYYY-MM-DD. */
  closedate?: string;
  /** Free-form description shown on the deal record. */
  description?: string;
  /** Owner. Defaults to Ben. */
  hubspot_owner_id?: string;
  /** Contact ID to associate on creation. */
  contactId?: string;
  /** Payment method (for our custom property). One of 'pay_now' | 'invoice_me' */
  payment_method?: "pay_now" | "invoice_me";
  /** Custom: onboarding gate. Starts false. Flips true when required forms are received. */
  onboarding_complete?: boolean;
  /** Custom: payment gate. Starts false. Flips true on Shopify orders/paid or QBO invoice paid. */
  payment_received?: boolean;
};

/**
 * Create a deal on the B2B Wholesale pipeline. If contactId is provided, the
 * deal is associated to the contact in a single request.
 */
export async function createDeal(input: DealInput): Promise<string | null> {
  const properties: Record<string, string> = {
    dealname: input.dealname,
    pipeline: input.pipeline ?? PIPELINE_B2B_WHOLESALE,
    dealstage: input.dealstage ?? STAGE_PO_RECEIVED,
    hubspot_owner_id: input.hubspot_owner_id ?? DEFAULT_OWNER_ID,
  };
  if (input.amount !== undefined) properties.amount = String(input.amount);
  if (input.closedate) properties.closedate = input.closedate;
  if (input.description) properties.description = input.description;
  // Custom properties — safe to send even if not yet defined in the portal;
  // HubSpot silently drops unknown properties rather than erroring.
  if (input.payment_method) properties.wholesale_payment_method = input.payment_method;
  if (input.onboarding_complete !== undefined) {
    properties.wholesale_onboarding_complete = input.onboarding_complete ? "true" : "false";
  }
  if (input.payment_received !== undefined) {
    properties.wholesale_payment_received = input.payment_received ? "true" : "false";
  }

  const body: Record<string, unknown> = { properties };
  if (input.contactId) {
    body.associations = [
      {
        to: { id: input.contactId },
        types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: ASSOC_DEAL_TO_CONTACT }],
      },
    ];
  }

  const res = await hsRequest<{ id: string }>("POST", "/crm/v3/objects/deals", body);
  if (!res.ok || !res.data?.id) return null;
  return res.data.id;
}

export type EmailEngagementInput = {
  subject: string;
  /** Plain-text body snippet */
  body: string;
  /** ISO timestamp. Defaults to now. */
  timestamp?: string;
  /** One of: EMAIL (outgoing), INCOMING_EMAIL, FORWARDED_EMAIL. Defaults to EMAIL. */
  direction?: "EMAIL" | "INCOMING_EMAIL" | "FORWARDED_EMAIL";
  /** Sender email (required for incoming). */
  from?: string;
  /** Recipient email. */
  to?: string;
  contactId?: string;
  dealId?: string;
};

/**
 * Log an email engagement on a contact + deal. Use this to record the welcome
 * email on the contact's timeline right after booth-order submit.
 */
export async function logEmail(input: EmailEngagementInput): Promise<string | null> {
  const properties: Record<string, string> = {
    hs_timestamp: input.timestamp ?? new Date().toISOString(),
    hs_email_subject: input.subject,
    hs_email_direction: input.direction ?? "EMAIL",
    hs_email_status: "SENT",
    hs_email_text: input.body.slice(0, 4000),
  };
  if (input.from) properties.hs_email_headers = JSON.stringify({ from: { email: input.from } });
  if (input.to) properties.hs_email_to_email = input.to;

  const associations: unknown[] = [];
  if (input.contactId) {
    associations.push({
      to: { id: input.contactId },
      types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: ASSOC_EMAIL_TO_CONTACT }],
    });
  }
  if (input.dealId) {
    associations.push({
      to: { id: input.dealId },
      types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: ASSOC_EMAIL_TO_DEAL }],
    });
  }

  const res = await hsRequest<{ id: string }>("POST", "/crm/v3/objects/emails", {
    properties,
    associations,
  });
  if (!res.ok || !res.data?.id) return null;
  return res.data.id;
}

export type NoteInput = {
  /** HTML body. Keep it short — shown on the record timeline. */
  body: string;
  timestamp?: string;
  contactId?: string;
  dealId?: string;
};

export async function createNote(input: NoteInput): Promise<string | null> {
  const properties: Record<string, string> = {
    hs_timestamp: input.timestamp ?? new Date().toISOString(),
    hs_note_body: input.body,
  };
  const associations: unknown[] = [];
  if (input.contactId) {
    associations.push({
      to: { id: input.contactId },
      types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: ASSOC_NOTE_TO_CONTACT }],
    });
  }
  if (input.dealId) {
    associations.push({
      to: { id: input.dealId },
      types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: ASSOC_NOTE_TO_DEAL }],
    });
  }
  const res = await hsRequest<{ id: string }>("POST", "/crm/v3/objects/notes", {
    properties,
    associations,
  });
  if (!res.ok || !res.data?.id) return null;
  return res.data.id;
}

/**
 * Split "Jane Q Doe" into firstname + lastname. Best-effort.
 */
export function splitName(full: string): { firstname: string; lastname: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstname: "", lastname: "" };
  if (parts.length === 1) return { firstname: parts[0], lastname: "" };
  return { firstname: parts[0], lastname: parts.slice(1).join(" ") };
}
