import { kv } from "@vercel/kv";
import { randomUUID } from "node:crypto";

export const WORKPACK_STATUSES = [
  "queued",
  "running",
  "needs_review",
  "approved",
  "done",
  "failed",
] as const;

export const WORKPACK_INTENTS = [
  "draft_reply",
  "prepare_codex_prompt",
  "summarize_thread",
  "research",
] as const;

export const WORKPACK_DEPARTMENTS = [
  "sales",
  "finance",
  "email",
  "shipping",
  "marketing",
  "ops",
  "general",
] as const;

export type WorkpackStatus = (typeof WORKPACK_STATUSES)[number];
export type WorkpackIntent = (typeof WORKPACK_INTENTS)[number];
export type WorkpackDepartment = (typeof WORKPACK_DEPARTMENTS)[number];
export type WorkpackRiskClass = "read_only" | "approval_required";

export interface WorkpackInput {
  intent: WorkpackIntent;
  department?: WorkpackDepartment;
  title: string;
  sourceText: string;
  sourceUrl?: string;
  requestedBy?: string;
  allowedActions?: string[];
  prohibitedActions?: string[];
  riskClass?: WorkpackRiskClass;
}

export interface WorkpackRecord {
  id: string;
  status: WorkpackStatus;
  intent: WorkpackIntent;
  department: WorkpackDepartment;
  title: string;
  sourceText: string;
  sourceUrl?: string;
  requestedBy?: string;
  allowedActions: string[];
  prohibitedActions: string[];
  riskClass: WorkpackRiskClass;
  assignedTo?: string;
  resultSummary?: string;
  resultPrompt?: string;
  resultLinks?: string[];
  failureReason?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkpackUpdatePatch {
  status?: WorkpackStatus;
  assignedTo?: string | null;
  resultSummary?: string | null;
  resultPrompt?: string | null;
  resultLinks?: string[] | null;
  failureReason?: string | null;
}

export class WorkpackUpdateError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "invalid_status"
      | "invalid_links"
      | "no_changes",
    message: string,
  ) {
    super(message);
    this.name = "WorkpackUpdateError";
  }
}

export type WorkpackValidation =
  | { ok: true; value: Omit<WorkpackRecord, "id" | "status" | "createdAt" | "updatedAt"> }
  | { ok: false; issues: string[] };

const INDEX_KEY = "ops:workpacks:index";
const RECORD_PREFIX = "ops:workpacks:";
const INDEX_CAP = 1_000;

const DEFAULT_PROHIBITED = [
  "send_email",
  "change_hubspot_stage",
  "write_qbo",
  "change_shopify_pricing",
  "change_cart_or_checkout",
  "buy_shipping_label",
  "change_ad_spend",
];

function isOneOf<T extends readonly string[]>(value: string, allowed: T): value is T[number] {
  return (allowed as readonly string[]).includes(value);
}

function cleanList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .slice(0, 20);
}

export function validateWorkpackInput(input: unknown): WorkpackValidation {
  const issues: string[] = [];
  if (!input || typeof input !== "object") {
    return { ok: false, issues: ["body must be an object"] };
  }
  const obj = input as Record<string, unknown>;
  const intentRaw = typeof obj.intent === "string" ? obj.intent.trim() : "";
  const departmentRaw =
    typeof obj.department === "string" ? obj.department.trim() : "general";
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const sourceText =
    typeof obj.sourceText === "string" ? obj.sourceText.trim() : "";
  const sourceUrl = typeof obj.sourceUrl === "string" ? obj.sourceUrl.trim() : "";
  const requestedBy =
    typeof obj.requestedBy === "string" ? obj.requestedBy.trim() : "";
  const riskClass =
    obj.riskClass === "approval_required" ? "approval_required" : "read_only";

  if (!isOneOf(intentRaw, WORKPACK_INTENTS)) issues.push("invalid intent");
  if (!isOneOf(departmentRaw, WORKPACK_DEPARTMENTS)) {
    issues.push("invalid department");
  }
  if (!title) issues.push("title is required");
  if (!sourceText) issues.push("sourceText is required");
  if (sourceText.length > 10_000) issues.push("sourceText exceeds 10000 chars");
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
    issues.push("sourceUrl must be http(s)");
  }
  if (issues.length > 0) return { ok: false, issues };
  const intent = intentRaw as WorkpackIntent;
  const department = departmentRaw as WorkpackDepartment;

  const prohibited = Array.from(
    new Set([...DEFAULT_PROHIBITED, ...cleanList(obj.prohibitedActions)]),
  );

  return {
    ok: true,
    value: {
      intent,
      department,
      title,
      sourceText,
      sourceUrl: sourceUrl || undefined,
      requestedBy: requestedBy || undefined,
      allowedActions: cleanList(obj.allowedActions),
      prohibitedActions: prohibited,
      riskClass,
    },
  };
}

export async function createWorkpack(
  input: WorkpackInput,
  options: { now?: Date; id?: string } = {},
): Promise<WorkpackRecord> {
  const validated = validateWorkpackInput(input);
  if (!validated.ok) {
    throw new Error(`invalid_workpack: ${validated.issues.join(", ")}`);
  }
  const now = (options.now ?? new Date()).toISOString();
  const record: WorkpackRecord = {
    id: options.id ?? `wp_${randomUUID()}`,
    status: "queued",
    ...validated.value,
    createdAt: now,
    updatedAt: now,
  };
  await kv.set(`${RECORD_PREFIX}${record.id}`, record);
  const existing = ((await kv.get<string[]>(INDEX_KEY)) ?? []).filter(
    (id) => id !== record.id,
  );
  await kv.set(INDEX_KEY, [record.id, ...existing].slice(0, INDEX_CAP));
  return record;
}

export async function getWorkpack(id: string): Promise<WorkpackRecord | null> {
  const clean = id.trim();
  if (!clean) return null;
  return (await kv.get<WorkpackRecord>(`${RECORD_PREFIX}${clean}`)) ?? null;
}

export async function listWorkpacks(
  options: { limit?: number } = {},
): Promise<WorkpackRecord[]> {
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const ids = ((await kv.get<string[]>(INDEX_KEY)) ?? []).slice(0, limit);
  const rows: WorkpackRecord[] = [];
  for (const id of ids) {
    const row = await getWorkpack(id);
    if (row) rows.push(row);
  }
  return rows;
}

function cleanOptional(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  return clean || undefined;
}

function cleanResultLinks(value: string[] | null | undefined): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new WorkpackUpdateError("invalid_links", "resultLinks must be an array");
  }
  const links = value
    .map((link) => (typeof link === "string" ? link.trim() : ""))
    .filter(Boolean);
  if (links.some((link) => !/^https?:\/\//i.test(link))) {
    throw new WorkpackUpdateError(
      "invalid_links",
      "resultLinks must be http(s) URLs",
    );
  }
  return Array.from(new Set(links)).slice(0, 10);
}

export async function updateWorkpack(
  id: string,
  patch: WorkpackUpdatePatch,
  options: { now?: Date } = {},
): Promise<WorkpackRecord> {
  const existing = await getWorkpack(id);
  if (!existing) {
    throw new WorkpackUpdateError("not_found", `Workpack ${id} not found`);
  }
  const next: WorkpackRecord = { ...existing };
  let changed = false;

  if (patch.status !== undefined) {
    if (!isOneOf(patch.status, WORKPACK_STATUSES)) {
      throw new WorkpackUpdateError("invalid_status", "Invalid workpack status");
    }
    if (patch.status !== next.status) {
      next.status = patch.status;
      changed = true;
    }
  }

  const stringFields = [
    "assignedTo",
    "resultSummary",
    "resultPrompt",
    "failureReason",
  ] as const;
  for (const field of stringFields) {
    if (field in patch) {
      const value = cleanOptional(patch[field]);
      if (value === undefined) {
        if (next[field] !== undefined) {
          delete next[field];
          changed = true;
        }
      } else if (next[field] !== value) {
        next[field] = value;
        changed = true;
      }
    }
  }

  if ("resultLinks" in patch) {
    const links = cleanResultLinks(patch.resultLinks);
    const current = JSON.stringify(next.resultLinks ?? []);
    const incoming = JSON.stringify(links ?? []);
    if (current !== incoming) {
      if (links && links.length > 0) next.resultLinks = links;
      else delete next.resultLinks;
      changed = true;
    }
  }

  if (!changed) {
    throw new WorkpackUpdateError("no_changes", "No workpack changes supplied");
  }

  const now = (options.now ?? new Date()).toISOString();
  next.updatedAt = now;
  if (next.status === "done" || next.status === "failed") {
    next.completedAt = next.completedAt ?? now;
  } else {
    delete next.completedAt;
  }
  await kv.set(`${RECORD_PREFIX}${next.id}`, next);
  return next;
}
