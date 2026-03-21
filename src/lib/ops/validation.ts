/**
 * Zod-based request validation utilities for ops API routes.
 *
 * Phase 1A: Enterprise hardening — validates all POST/PATCH/PUT inputs
 * before processing to prevent malformed data, injection, and oversized payloads.
 */

import { z } from "zod";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "input";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

// ---------------------------------------------------------------------------
// Core validateRequest helper
// ---------------------------------------------------------------------------

type ValidationSuccess<T> = { success: true; data: T };
type ValidationFailure = { success: false; response: NextResponse };

/**
 * Parse a Request body against a Zod schema.
 * Returns typed data on success, or a pre-built 400 NextResponse on failure.
 *
 * Usage:
 * ```ts
 * const v = await validateRequest(req, MySchema);
 * if (!v.success) return v.response;
 * const { field1, field2 } = v.data;
 * ```
 */
export async function validateRequest<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<ValidationSuccess<z.infer<T>> | ValidationFailure> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      ),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: "Validation failed",
          details: formatZodError(result.error),
        },
        { status: 400 },
      ),
    };
  }

  return { success: true, data: result.data as z.infer<T> };
}

/**
 * Validate query parameters against a Zod schema.
 * Extracts searchParams from the URL and validates them.
 */
export function validateQuery<T extends z.ZodType>(
  req: Request,
  schema: T,
): ValidationSuccess<z.infer<T>> | ValidationFailure {
  const url = new URL(req.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  const result = schema.safeParse(params);
  if (!result.success) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: "Invalid query parameters",
          details: formatZodError(result.error),
        },
        { status: 400 },
      ),
    };
  }

  return { success: true, data: result.data as z.infer<T> };
}

// ---------------------------------------------------------------------------
// Reusable base schemas
// ---------------------------------------------------------------------------

/** UUID v4 string */
export const uuidSchema = z
  .string()
  .trim()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Must be a valid UUID",
  );

/** Email address */
export const emailSchema = z.string().trim().email("Must be a valid email");

/** Date in YYYY-MM-DD format */
export const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format");

/** Currency amount (positive or negative) */
export const currencySchema = z
  .number()
  .min(-10_000_000, "Amount too small")
  .max(10_000_000, "Amount too large");

/** Positive currency amount */
export const positiveCurrencySchema = z
  .number()
  .min(0, "Amount must be non-negative")
  .max(10_000_000, "Amount too large");

/** Safe text field with reasonable length */
export const safeTextSchema = (maxLen = 5000) =>
  z.string().trim().max(maxLen);

/** Safe title field */
export const safeTitleSchema = (maxLen = 200) =>
  z.string().trim().min(1, "Required").max(maxLen);

/** Notion page ID (32 hex chars, no dashes) */
export const notionPageIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{32}$/i, "Must be a valid Notion page ID");

/** Department enum */
export const departmentSchema = z.enum([
  "executive",
  "finance",
  "operations",
  "sales_and_growth",
  "marketing",
  "systems",
  "product",
]);

/** Risk level */
export const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

/** Confidence 0-1 */
export const confidenceSchema = z
  .number()
  .min(0)
  .max(1)
  .default(0.5);

/** Notification channel */
export const notifyChannelSchema = z.enum(["alerts", "pipeline", "daily"]);

// ---------------------------------------------------------------------------
// Route-specific schemas
// ---------------------------------------------------------------------------

/** POST /api/ops/chat */
export const ChatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().max(50000),
      }),
    )
    .min(1, "At least one message is required")
    .max(100, "Too many messages"),
});

/** POST /api/ops/notify */
export const NotifyRequestSchema = z.object({
  channel: notifyChannelSchema,
  text: z.string().trim().min(1, "text is required").max(5000),
  sms: z.boolean().optional(),
});

/** POST /api/ops/abra/teach */
export const TeachRequestSchema = z.object({
  department: z.string().trim().max(50).optional().default(""),
  content: z.string().trim().min(1, "content is required").max(10000),
  title: z.string().trim().max(200).optional(),
  source: z.string().trim().max(200).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

/** POST /api/ops/abra/correct */
export const CorrectRequestSchema = z.object({
  original_claim: z
    .string()
    .trim()
    .min(1, "original_claim is required")
    .max(2000),
  correction: z.string().trim().min(1, "correction is required").max(2000),
  department: z.string().trim().max(50).optional(),
});

/** POST /api/ops/abra/propose */
export const ProposeRequestSchema = z.object({
  action_type: z
    .string()
    .trim()
    .min(1, "action_type is required")
    .max(100),
  description: z
    .string()
    .trim()
    .min(1, "description is required")
    .max(500),
  details: z.record(z.string(), z.unknown()).optional().default({}),
  confidence: z.number().min(0).max(1).optional().default(0.5),
  risk_level: z.enum(["low", "medium", "high"]).optional().default("medium"),
});

/** POST /api/ops/abra/actions (execute) */
export const ExecuteActionSchema = z.object({
  approval_id: uuidSchema,
  confirm: z.literal(true, { message: "confirm must be true" }),
});

/** POST /api/ops/abra/actions/propose */
export const ActionsProposeSchema = z.object({
  department: z.string().trim().optional().default("executive"),
  action_type: z.string().trim().min(1, "action_type is required"),
  title: z.string().trim().min(1, "title is required"),
  description: z.string().trim().min(1, "description is required"),
  params: z.record(z.string(), z.unknown()).optional().default({}),
  risk_level: z
    .enum(["critical", "high", "medium", "low"])
    .optional()
    .default("medium"),
  confidence: z.number().min(0).max(1).optional().default(0.8),
  auto_execute: z.boolean().optional().default(false),
});

/** POST /api/ops/abra/write-back */
export const WriteBackSchema = z.object({
  table: z.enum(["open_brain_entries", "email_events"], {
    message: "Invalid table. Allowed: open_brain_entries, email_events",
  }),
  action: z.enum(["insert", "update"], {
    message: "Invalid action. Allowed: insert, update",
  }),
  data: z
    .record(z.string(), z.unknown())
    .refine((d) => Object.keys(d).length > 0, "data object is required"),
  reason: z
    .string()
    .trim()
    .min(1, "reason is required")
    .max(1000),
});

/** POST /api/ops/abra/answer-question */
export const AnswerQuestionSchema = z.object({
  question_id: uuidSchema,
  answer: z.string().trim().min(1, "answer is required").max(10000),
});

/** PATCH /api/ops/abra/approvals */
export const ApprovalDecisionSchema = z.object({
  id: uuidSchema,
  decision: z.enum(["approved", "rejected"], {
    message: "decision must be approved or rejected",
  }),
  comment: z.string().max(2000).optional(),
});

/** POST /api/ops/wholesale/order */
export const WholesaleOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(200),
  customerEmail: emailSchema,
  companyName: z.string().trim().max(200).optional(),
  lineItems: z
    .array(
      z.object({
        variantId: z.string().trim().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1, "At least one line item is required"),
  note: z.string().trim().max(1000).optional(),
  shippingAddress: z
    .object({
      address1: z.string().trim().min(1),
      city: z.string().trim().min(1),
      province: z.string().trim().min(1),
      country: z.string().trim().min(1),
      zip: z.string().trim().min(1),
    })
    .optional(),
});

/** POST /api/ops/marketing/auto-post */
export const AutoPostSchema = z.object({
  topic: z.string().trim().min(1, "topic is required").max(500),
  platforms: z
    .array(z.enum(["x", "truth"]))
    .optional()
    .default(["x", "truth"]),
  style: z
    .enum([
      "product-hero",
      "lifestyle",
      "patriotic",
      "health-wellness",
      "social-post",
    ])
    .optional()
    .default("social-post"),
  blogUrl: z.string().url().optional(),
  dryRun: z.boolean().optional().default(false),
});

/** POST /api/ops/marketing/content/actions */
export const ContentActionSchema = z.object({
  action: z.enum(["approve", "reject", "edit", "generate"], {
    message: "Unsupported action. Use approve | reject | edit | generate",
  }),
  pageId: z.string().trim().optional(),
  title: z.string().trim().max(300).optional(),
  slug: z.string().trim().max(200).optional(),
  body: z.string().max(100000).optional(),
  keyword: z.string().trim().max(200).optional(),
  outline: z.string().max(5000).optional(),
  reason: z.string().trim().max(1000).optional(),
});

/** POST /api/ops/marketing/images */
export const ImageActionSchema = z.object({
  action: z.enum(
    ["upload", "generate", "generate-gemini", "generate-gemini-ref"],
    {
      message:
        "Unsupported action. Use upload | generate | generate-gemini | generate-gemini-ref",
    },
  ),
  title: z.string().trim().max(200).optional(),
  filename: z.string().trim().max(200).optional(),
  contentBase64: z.string().max(15_000_000).optional(),
  tags: z.array(z.string().trim().max(50)).max(20).optional(),
  category: z.string().trim().max(50).optional(),
  prompt: z.string().trim().max(2000).optional(),
  style: z.string().trim().max(50).optional(),
  referenceImageBase64: z.string().max(15_000_000).optional(),
  referenceMimeType: z.string().trim().max(50).optional(),
});

/** DELETE /api/ops/abra/ingest */
export const IngestDeleteSchema = z.object({
  document_id: uuidSchema,
});

/** GET /api/ops/abra/finance query params */
export const FinanceQuerySchema = z.object({
  view: z
    .enum(["snapshot", "margins", "timeline"])
    .optional()
    .default("snapshot"),
  period: z.enum(["day", "week", "month"]).optional().default("month"),
  days: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return 30;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 1), 365) : 30;
    }),
});
