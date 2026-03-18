import { z } from "zod";

export const VALID_BRAIN_CATEGORIES = [
  "market_intel",
  "financial",
  "operational",
  "regulatory",
  "customer_insight",
  "deal_data",
  "email_triage",
  "competitive",
  "research",
  "field_note",
  "system_log",
  "teaching",
  "general",
  "company_info",
  "product_info",
  "supply_chain",
  "sales",
  "founder",
  "culture",
  "correction",
  "production_run",
  "vendor_quote",
  "scenario_analysis",
] as const;

export const VALID_BRAIN_ENTRY_TYPES = [
  "finding",
  "research",
  "field_note",
  "summary",
  "alert",
  "system_log",
  "correction",
  "teaching",
  "kpi",
  "session_summary",
  "auto_teach",
] as const;

const notionIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f-]{32,36}$/i, "Must be a valid Notion page ID");

export const SendSlackSchema = z.object({
  channel: z.enum(["alerts", "pipeline", "daily"]),
  message: z.string().trim().min(1).max(3000),
});

export const SendEmailSchema = z.object({
  to: z.string().trim().email(),
  subject: z.string().trim().max(200),
  body: z.string().trim().min(1).max(10000),
});

export const DraftEmailReplySchema = z.object({
  to: z.string().trim().email(),
  subject: z.string().trim().max(200),
  body: z.string().trim().min(1).max(10000),
  source_email_id: z.string().trim().min(1).optional(),
  sender_name: z.string().trim().min(1).optional(),
});

export const CreateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  priority: z.enum(["critical", "high", "normal", "low"]).default("normal"),
  task_type: z.string().trim().min(1).optional(),
});

export const UpdateNotionSchema = z.object({
  page_id: notionIdSchema,
  content: z.string().trim().max(10000).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

export const CreateBrainEntrySchema = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(5000),
  category: z.enum(VALID_BRAIN_CATEGORIES).default("general"),
  department: z.string().trim().max(50).optional(),
  entry_type: z.enum(VALID_BRAIN_ENTRY_TYPES).default("finding"),
  tags: z.array(z.string().trim().min(1)).max(10).optional(),
});

export const AcknowledgeSignalSchema = z.object({
  signal_id: z.string().uuid(),
});

export const PauseInitiativeSchema = z.object({
  initiative_id: z.string().uuid(),
});

export const CreateNotionPageSchema = z.object({
  database: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().max(10000).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

export const RecordTransactionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().min(0).max(100000),
  type: z.enum([
    "income",
    "expense",
    "transfer",
    "refund",
    "cogs",
    "tax",
    "shipping",
  ]),
  vendor: z.string().trim().optional(),
  description: z.string().trim().min(1).max(1000),
  category: z.string().trim().optional(),
  account_code: z.string().trim().optional(),
});

export const LogProductionRunSchema = z.object({
  batch_date: z.string().trim().min(1),
  quantity: z.number().int().positive(),
  cost_per_unit: z.number().positive(),
  vendor: z.string().trim().min(1),
  notes: z.string().trim().optional(),
});

export const RecordVendorQuoteSchema = z.object({
  vendor: z.string().trim().min(1),
  product: z.string().trim().min(1),
  price_per_unit: z.number().positive(),
  min_order_qty: z.number().int().positive().optional(),
  valid_until: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export const RunScenarioSchema = z.object({
  scenario_type: z.string().trim().min(1),
  parameters: z.record(z.string(), z.unknown()),
});

export const ReadEmailSchema = z.object({
  email_id: z.string().trim().min(1),
});

export const SearchEmailSchema = z.object({
  query: z.string().trim().min(1),
  limit: z.number().int().min(1).max(50).optional(),
});

export const QueryLedgerSchema = z.object({
  fiscal_year: z.string().trim().optional(),
  category: z.string().trim().optional(),
  account_code: z.string().trim().optional(),
});

export const CorrectClaimSchema = z.object({
  original_claim: z.string().trim().min(1),
  correction: z.string().trim().min(1),
  source: z.string().trim().optional(),
});

export const ActionSchemas = {
  send_slack: SendSlackSchema,
  send_email: SendEmailSchema,
  draft_email_reply: DraftEmailReplySchema,
  create_task: CreateTaskSchema,
  update_notion: UpdateNotionSchema,
  create_brain_entry: CreateBrainEntrySchema,
  acknowledge_signal: AcknowledgeSignalSchema,
  pause_initiative: PauseInitiativeSchema,
  create_notion_page: CreateNotionPageSchema,
  record_transaction: RecordTransactionSchema,
  log_production_run: LogProductionRunSchema,
  record_vendor_quote: RecordVendorQuoteSchema,
  run_scenario: RunScenarioSchema,
  read_email: ReadEmailSchema,
  search_email: SearchEmailSchema,
  query_ledger: QueryLedgerSchema,
  correct_claim: CorrectClaimSchema,
} as const;

export type ActionSchemaMap = typeof ActionSchemas;
export type KnownActionType = keyof ActionSchemaMap;
export type ValidatedActionParams<T extends KnownActionType> = z.infer<
  ActionSchemaMap[T]
>;

type ValidationSuccess<T> = { success: true; data: T };
type ValidationFailure = { success: false; error: string };

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "params";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function validateActionParams<T extends KnownActionType>(
  actionType: T,
  params: unknown,
): ValidationSuccess<ValidatedActionParams<T>> | ValidationFailure;
export function validateActionParams(
  actionType: string,
  params: unknown,
): ValidationSuccess<Record<string, unknown>> | ValidationFailure;
export function validateActionParams(
  actionType: string,
  params: unknown,
): ValidationSuccess<Record<string, unknown>> | ValidationFailure {
  const schema = ActionSchemas[actionType as KnownActionType];
  if (!schema) {
    if (params && typeof params === "object" && !Array.isArray(params)) {
      return { success: true, data: params as Record<string, unknown> };
    }
    return { success: true, data: {} };
  }

  const result = schema.safeParse(params);
  if (!result.success) {
    return { success: false, error: formatZodError(result.error) };
  }

  return { success: true, data: result.data as Record<string, unknown> };
}
