import { randomUUID } from "node:crypto";

import { kv } from "@vercel/kv";

import { createQBOVendor, type QBOVendorInput } from "@/lib/ops/qbo-client";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { requestApproval } from "@/lib/ops/control-plane/record";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { auditSurface } from "@/lib/ops/control-plane/slack";
import type {
  ApprovalRequest,
  RunContext,
} from "@/lib/ops/control-plane/types";
import { getNotionApiKey, getNotionCredential } from "@/lib/notion/credentials";

const PAYLOAD_PREFIX = "vendor-onboarding:payload:";
const PENDING_PREFIX = "vendor-onboarding:pending:";
const REGISTRY_PREFIX = "vendor-onboarding:registry:";
const RESULT_PREFIX = "vendor-onboarding:result:";
const PAYLOAD_TTL_SECONDS = 14 * 24 * 3600;

export type VendorOnboardingInput = {
  name: string;
  companyName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  terms?: string;
  termsId?: string;
  taxClass?: string;
  taxIdentifier?: string;
  accountNumber?: string;
  w9DriveUrl?: string;
  coiDriveUrl?: string;
  originator?: string;
  notes?: string;
};

type StoredVendorPayload = {
  kind: "vendor-onboarding-v1";
  input: VendorOnboardingInput;
  dedupeKey: string;
  createdAt: string;
};

type VendorArtifactResult =
  | { ok: true; status: "created"; id: string; url?: string }
  | { ok: true; status: "skipped"; reason: string }
  | { ok: false; status: "error"; error: string };

export type VendorOnboardingResult = {
  ok: boolean;
  approvalId: string;
  vendorName: string;
  qboVendorId?: string;
  notion?: VendorArtifactResult;
  drive?: VendorArtifactResult;
  error?: string;
};

export type OpenVendorOnboardingResult =
  | {
      ok: true;
      approvalId: string;
      proposalTs: string | null;
      payloadRef: string;
      dedupeKey: string;
    }
  | { ok: false; error: string; status?: number; existing?: unknown };

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cleanEmail(value: unknown): string | undefined {
  const email = clean(value)?.toLowerCase();
  if (!email) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  return email;
}

function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj) as Array<[keyof T, T[keyof T]]>) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = value;
  }
  return out;
}

export function normalizeVendorKey(input: Pick<VendorOnboardingInput, "name" | "email">): string {
  const base = (input.email || input.name || "vendor")
    .toLowerCase()
    .replace(/[^a-z0-9@._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "vendor";
}

export function parseVendorOnboardingInput(raw: unknown): {
  ok: true;
  input: VendorOnboardingInput;
} | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "JSON object body required" };
  }
  const body = raw as Record<string, unknown>;
  const name = clean(body.name);
  if (!name) return { ok: false, error: "name is required" };

  const email = cleanEmail(body.email);
  if (body.email && !email) return { ok: false, error: "email is invalid" };

  const addressRaw =
    body.address && typeof body.address === "object"
      ? (body.address as Record<string, unknown>)
      : {};
  const address = compact({
    line1: clean(addressRaw.line1) || clean(body.addressLine1) || clean(body.address),
    line2: clean(addressRaw.line2) || clean(body.addressLine2),
    city: clean(addressRaw.city) || clean(body.city),
    state: clean(addressRaw.state) || clean(body.state)?.toUpperCase(),
    postalCode: clean(addressRaw.postalCode) || clean(body.postalCode) || clean(body.zip),
    country: clean(addressRaw.country) || clean(body.country) || "US",
  });

  const input: VendorOnboardingInput = compact({
    name,
    companyName: clean(body.companyName) || clean(body.company_name) || name,
    contactName: clean(body.contactName) || clean(body.contact_name),
    email,
    phone: clean(body.phone),
    website: clean(body.website),
    address: Object.keys(address).length > 0 ? address : undefined,
    terms: clean(body.terms),
    termsId: clean(body.termsId) || clean(body.terms_id),
    taxClass: clean(body.taxClass) || clean(body.tax_class),
    taxIdentifier: clean(body.taxIdentifier) || clean(body.tax_id),
    accountNumber: clean(body.accountNumber) || clean(body.acct_num),
    w9DriveUrl: clean(body.w9DriveUrl) || clean(body.w9_drive_url),
    coiDriveUrl: clean(body.coiDriveUrl) || clean(body.coi_drive_url),
    originator: clean(body.originator),
    notes: clean(body.notes),
  }) as VendorOnboardingInput;

  return { ok: true, input };
}

function maskTaxId(value?: string): string {
  if (!value) return "not provided";
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return "provided";
  return `provided ending ${digits.slice(-4)}`;
}

function toNotionId(raw: string): string {
  const cleanId = raw.replace(/-/g, "");
  if (cleanId.length !== 32) return raw;
  return `${cleanId.slice(0, 8)}-${cleanId.slice(8, 12)}-${cleanId.slice(12, 16)}-${cleanId.slice(16, 20)}-${cleanId.slice(20)}`;
}

function buildVendorPreview(input: VendorOnboardingInput): string {
  const address = input.address
    ? [
        input.address.line1,
        input.address.line2,
        [input.address.city, input.address.state, input.address.postalCode].filter(Boolean).join(" "),
        input.address.country,
      ].filter(Boolean).join(", ")
    : "not provided";
  return [
    "*Vendor master creation request*",
    "",
    `Vendor: ${input.name}`,
    `Company: ${input.companyName || input.name}`,
    `Contact: ${input.contactName || "not provided"}`,
    `Email: ${input.email || "not provided"}`,
    `Phone: ${input.phone || "not provided"}`,
    `Address: ${address}`,
    `Terms: ${input.terms || input.termsId || "not provided"}`,
    `Tax class: ${input.taxClass || "not provided"}`,
    `Tax ID: ${maskTaxId(input.taxIdentifier)}`,
    `W-9: ${input.w9DriveUrl ? "Drive link provided" : "not provided"}`,
    `COI: ${input.coiDriveUrl ? "Drive link provided" : "not provided"}`,
    "",
    "_Rene approval required. QBO vendor is created only after approval._",
  ].join("\n");
}

export async function openVendorOnboardingApproval(
  input: VendorOnboardingInput,
): Promise<OpenVendorOnboardingResult> {
  const dedupeKey = normalizeVendorKey(input);
  const registryKey = `${REGISTRY_PREFIX}${dedupeKey}`;
  const pendingKey = `${PENDING_PREFIX}${dedupeKey}`;

  const existing = await kv.get(registryKey);
  if (existing) {
    return { ok: false, error: "Vendor already exists in onboarding registry", status: 409, existing };
  }
  const pending = await kv.get<string>(pendingKey);
  if (pending) {
    return { ok: false, error: "Vendor onboarding approval already pending", status: 409, existing: { payloadRef: pending } };
  }

  const payloadRef = `${PAYLOAD_PREFIX}${randomUUID()}`;
  const payload: StoredVendorPayload = {
    kind: "vendor-onboarding-v1",
    input,
    dedupeKey,
    createdAt: new Date().toISOString(),
  };
  await kv.set(payloadRef, JSON.stringify(payload), { ex: PAYLOAD_TTL_SECONDS });
  await kv.set(pendingKey, payloadRef, { ex: PAYLOAD_TTL_SECONDS });

  try {
    const run = newRunContext({
      agentId: "vendor-onboarding",
      division: "financials",
      source: "human-invoked",
      trigger: `vendor:onboard:${dedupeKey}`,
    });
    const approval = await requestApproval(run, {
      actionSlug: "vendor.master.create",
      targetSystem: "qbo",
      targetEntity: {
        type: "vendor-master",
        id: dedupeKey,
        label: input.name,
      },
      payloadPreview: buildVendorPreview(input),
      payloadRef,
      evidence: {
        claim: `Create vendor master for ${input.name} after Rene approval.`,
        sources: [
          {
            system: "ops:vendor-onboarding-form",
            id: dedupeKey,
            retrievedAt: new Date().toISOString(),
          },
        ],
        confidence: 0.82,
      },
      rollbackPlan:
        "If created in error, Rene deactivates the QBO vendor, archives the Notion dossier, and moves/deletes the Drive folder. No vendor payments are released by this flow.",
    });
    return {
      ok: true,
      approvalId: approval.id,
      proposalTs: approval.slackThread?.ts ?? null,
      payloadRef,
      dedupeKey,
    };
  } catch (err) {
    await kv.del(payloadRef).catch(() => undefined);
    await kv.del(pendingKey).catch(() => undefined);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: 500,
    };
  }
}

async function loadPayload(payloadRef?: string): Promise<StoredVendorPayload | null> {
  if (!payloadRef?.startsWith(PAYLOAD_PREFIX)) return null;
  const raw = await kv.get<string | StoredVendorPayload>(payloadRef);
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as StoredVendorPayload;
    } catch {
      return null;
    }
  }
  return raw;
}

function qboVendorPayload(input: VendorOnboardingInput): QBOVendorInput {
  const addr = input.address;
  return compact({
    DisplayName: input.name,
    CompanyName: input.companyName || input.name,
    PrimaryEmailAddr: input.email ? { Address: input.email } : undefined,
    PrimaryPhone: input.phone ? { FreeFormNumber: input.phone } : undefined,
    WebAddr: input.website ? { URI: input.website } : undefined,
    BillAddr: addr
      ? compact({
          Line1: addr.line1,
          Line2: addr.line2,
          City: addr.city,
          CountrySubDivisionCode: addr.state,
          PostalCode: addr.postalCode,
          Country: addr.country || "US",
        })
      : undefined,
    PrintOnCheckName: input.companyName || input.name,
    AcctNum: input.accountNumber,
    TaxIdentifier: input.taxIdentifier,
    TermRef: input.termsId ? { value: input.termsId, name: input.terms } : undefined,
    Notes: [
      input.notes,
      input.taxClass ? `Tax class: ${input.taxClass}` : undefined,
      input.w9DriveUrl ? `W-9: ${input.w9DriveUrl}` : undefined,
      input.coiDriveUrl ? `COI: ${input.coiDriveUrl}` : undefined,
    ].filter(Boolean).join("\n") || undefined,
  }) as QBOVendorInput;
}

function vendorIdFromQbo(result: Record<string, unknown> | null): string | undefined {
  if (!result) return undefined;
  const vendor = (result.Vendor && typeof result.Vendor === "object")
    ? (result.Vendor as Record<string, unknown>)
    : result;
  const id = vendor.Id;
  return typeof id === "string" && id.trim() ? id : undefined;
}

function artifactSummary(artifact: VendorArtifactResult): string {
  if (artifact.status === "created") return `${artifact.status} (${artifact.url || artifact.id})`;
  if (artifact.status === "skipped") return `${artifact.status} - ${artifact.reason}`;
  return `${artifact.status} - ${artifact.error}`;
}

async function getDriveClient() {
  const clientId =
    process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GCP_GMAIL_OAUTH_CLIENT_ID;
  const clientSecret =
    process.env.GMAIL_OAUTH_CLIENT_SECRET ||
    process.env.GCP_GMAIL_OAUTH_CLIENT_SECRET;
  const refreshToken =
    process.env.GMAIL_OAUTH_REFRESH_TOKEN ||
    process.env.GCP_GMAIL_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  const { google } = await import("googleapis");
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth: oauth2 });
}

async function createDriveVendorFolder(input: VendorOnboardingInput): Promise<VendorArtifactResult> {
  const parentId =
    process.env.GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID ||
    process.env.DRIVE_VENDOR_ONBOARDING_PARENT_ID;
  if (!parentId) {
    return { ok: true, status: "skipped", reason: "GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID not set" };
  }
  const drive = await getDriveClient();
  if (!drive) {
    return { ok: true, status: "skipped", reason: "GMAIL_OAUTH_* env vars missing" };
  }
  try {
    const created = await drive.files.create({
      requestBody: {
        name: `${input.name} - Vendor Dossier`,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
        description: `USA Gummies vendor onboarding dossier for ${input.name}`,
      },
      fields: "id,name,webViewLink",
      supportsAllDrives: true,
    });
    const id = created.data.id;
    if (!id) return { ok: false, status: "error", error: "Drive folder created without id" };
    return {
      ok: true,
      status: "created",
      id,
      url: created.data.webViewLink ?? undefined,
    };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function createNotionVendorDossier(
  input: VendorOnboardingInput,
  qboVendorId: string,
): Promise<VendorArtifactResult> {
  const parentPageId =
    getNotionCredential("NOTION_VENDOR_DOSSIER_PARENT_PAGE_ID") ||
    getNotionCredential("NOTION_VENDOR_DOSSIERS_PARENT_PAGE_ID");
  const apiKey = getNotionApiKey();
  if (!parentPageId) {
    return { ok: true, status: "skipped", reason: "NOTION_VENDOR_DOSSIER_PARENT_PAGE_ID not set" };
  }
  if (!apiKey) {
    return { ok: true, status: "skipped", reason: "NOTION_API_KEY not set" };
  }

  const lines = [
    `QBO Vendor ID: ${qboVendorId}`,
    `Company: ${input.companyName || input.name}`,
    `Contact: ${input.contactName || "not provided"}`,
    `Email: ${input.email || "not provided"}`,
    `Phone: ${input.phone || "not provided"}`,
    `Terms: ${input.terms || input.termsId || "not provided"}`,
    `Tax class: ${input.taxClass || "not provided"}`,
    `W-9: ${input.w9DriveUrl || "not provided"}`,
    `COI: ${input.coiDriveUrl || "not provided"}`,
    `Notes: ${input.notes || "none"}`,
  ];

  try {
    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { page_id: toNotionId(parentPageId) },
        properties: {
          title: [{ text: { content: `${input.name} - Vendor Dossier` } }],
        },
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                { type: "text", text: { content: lines.join("\n") } },
              ],
            },
          },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, status: "error", error: `Notion create failed: ${res.status} ${text.slice(0, 240)}` };
    }
    const page = (await res.json()) as { id?: string; url?: string };
    if (!page.id) return { ok: false, status: "error", error: "Notion page created without id" };
    return { ok: true, status: "created", id: page.id, url: page.url };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function appendVendorAudit(
  run: RunContext,
  approval: ApprovalRequest,
  result: VendorOnboardingResult,
) {
  const entry = buildAuditEntry(run, {
    action: "vendor.master.create",
    entityType: "vendor",
    entityId: result.qboVendorId,
    result: result.ok ? "ok" : "error",
    approvalId: approval.id,
    after: result.ok ? result : undefined,
    error: result.error ? { message: result.error } : undefined,
    sourceCitations: [
      { system: "control-plane:approval", id: approval.id },
      ...(approval.payloadRef ? [{ system: "kv:payload", id: approval.payloadRef }] : []),
    ],
    confidence: approval.evidence.confidence,
  });
  await auditStore().append(entry);
  await auditSurface().mirror(entry).catch(() => undefined);
}

export async function executeApprovedVendorMasterCreate(
  approval: ApprovalRequest,
): Promise<
  | { ok: true; handled: false; reason: string }
  | { ok: true; handled: true; result: VendorOnboardingResult; threadMessage: string }
  | { ok: false; handled: true; error: string; threadMessage: string }
> {
  if (approval.status !== "approved") {
    return { ok: true, handled: false, reason: `approval status is ${approval.status}` };
  }
  if (approval.targetEntity?.type !== "vendor-master" && !approval.payloadRef?.startsWith(PAYLOAD_PREFIX)) {
    return { ok: true, handled: false, reason: "not a vendor-master approval" };
  }

  const resultKey = `${RESULT_PREFIX}${approval.id}`;
  const existing = await kv.get<VendorOnboardingResult>(resultKey);
  if (existing?.ok) {
    return {
      ok: true,
      handled: true,
      result: existing,
      threadMessage: `:white_check_mark: Vendor master already created for ${existing.vendorName}. QBO vendor ID: ${existing.qboVendorId}.`,
    };
  }

  const payload = await loadPayload(approval.payloadRef);
  if (!payload) {
    const msg = `vendor.master.create approval ${approval.id} missing stored payload`;
    return { ok: false, handled: true, error: msg, threadMessage: `:warning: ${msg}` };
  }

  const run: RunContext = {
    runId: approval.runId,
    agentId: "vendor-onboarding-approved-closer",
    division: "financials",
    startedAt: new Date().toISOString(),
    source: "event",
    trigger: `approval:${approval.id}`,
  };

  try {
    const qboResult = await createQBOVendor(qboVendorPayload(payload.input));
    const qboVendorId = vendorIdFromQbo(qboResult);
    if (!qboVendorId) {
      throw new Error("QBO vendor creation returned no Vendor.Id");
    }

    const partial: VendorOnboardingResult = {
      ok: true,
      approvalId: approval.id,
      vendorName: payload.input.name,
      qboVendorId,
    };
    await kv.set(resultKey, partial);

    const [notion, drive] = await Promise.all([
      createNotionVendorDossier(payload.input, qboVendorId),
      createDriveVendorFolder(payload.input),
    ]);

    const finalResult: VendorOnboardingResult = {
      ...partial,
      notion,
      drive,
    };
    await kv.set(resultKey, finalResult);
    await kv.set(`${REGISTRY_PREFIX}${payload.dedupeKey}`, finalResult);
    await kv.del(`${PENDING_PREFIX}${payload.dedupeKey}`).catch(() => undefined);
    await appendVendorAudit(run, approval, finalResult);

    const threadMessage = [
      `:white_check_mark: Approved \`vendor.master.create\` executed for ${payload.input.name}.`,
      `QBO vendor ID: \`${qboVendorId}\`.`,
      `Notion: ${artifactSummary(notion)}.`,
      `Drive: ${artifactSummary(drive)}.`,
      "No bill, PO, payment, or ACH release was created by this flow.",
    ].join("\n");
    return { ok: true, handled: true, result: finalResult, threadMessage };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const failed: VendorOnboardingResult = {
      ok: false,
      approvalId: approval.id,
      vendorName: payload.input.name,
      error,
    };
    await kv.set(resultKey, failed);
    await appendVendorAudit(run, approval, failed);
    return {
      ok: false,
      handled: true,
      error,
      threadMessage: `:warning: Vendor approval recorded, but QBO vendor creation failed for ${payload.input.name}: ${error}`,
    };
  }
}
