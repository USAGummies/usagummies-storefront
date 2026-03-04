/**
 * Shopify Admin API client — for operations requiring admin access:
 *   - Creating discount codes (loyalty rewards, subscription pricing)
 *   - Registering webhooks
 *   - Reading product/order data for ops
 *
 * Uses the Admin API token (shpat_*), NOT the Storefront token.
 */

const ADMIN_API_VERSION = "2024-10";

function getAdminEndpoint() {
  const domain =
    process.env.SHOPIFY_STORE_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    "usa-gummies.myshopify.com";
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${clean}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
}

function getAdminToken() {
  return process.env.SHOPIFY_ADMIN_TOKEN || "";
}

interface AdminResult<T> {
  ok: boolean;
  data: T | null;
  error?: string;
}

export async function adminRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<AdminResult<T>> {
  const endpoint = getAdminEndpoint();
  const token = getAdminToken();

  if (!token) {
    return { ok: false, data: null, error: "SHOPIFY_ADMIN_TOKEN not configured" };
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });

    const json = await res.json();

    if (!res.ok || json.errors?.length) {
      const errMsg = json.errors?.map((e: any) => e.message).join("; ") || `HTTP ${res.status}`;
      console.error("[shopify admin]", errMsg);
      return { ok: false, data: null, error: errMsg };
    }

    return { ok: true, data: json.data ?? null };
  } catch (err: any) {
    console.error("[shopify admin] fetch failed:", err?.message);
    return { ok: false, data: null, error: err?.message || "fetch failed" };
  }
}

// ---------------------------------------------------------------------------
// Discount code creation
// ---------------------------------------------------------------------------

const DISCOUNT_CODE_CREATE = /* GraphQL */ `
  mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            title
            codes(first: 1) {
              nodes {
                code
              }
            }
            startsAt
            endsAt
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface DiscountCreateResult {
  discountCodeBasicCreate: {
    codeDiscountNode: {
      id: string;
      codeDiscount: {
        title: string;
        codes: { nodes: Array<{ code: string }> };
        startsAt: string;
        endsAt: string | null;
      };
    } | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
}

/**
 * Create a fixed-amount discount code in Shopify.
 * Used for subscription pricing and loyalty rewards.
 */
export async function createDiscountCode(opts: {
  title: string;
  code: string;
  amountOff: number; // fixed dollar amount off
  usageLimit?: number;
  appliesOncePerCustomer?: boolean;
  endsAt?: string; // ISO date
}): Promise<{ ok: boolean; code?: string; discountId?: string; error?: string }> {
  const now = new Date().toISOString();

  const result = await adminRequest<DiscountCreateResult>(DISCOUNT_CODE_CREATE, {
    basicCodeDiscount: {
      title: opts.title,
      code: opts.code,
      startsAt: now,
      endsAt: opts.endsAt || null,
      usageLimit: opts.usageLimit ?? 1,
      appliesOncePerCustomer: opts.appliesOncePerCustomer ?? true,
      customerGets: {
        value: {
          discountAmount: {
            amount: opts.amountOff.toFixed(2),
            appliesOnEachItem: false,
          },
        },
        items: {
          all: true,
        },
      },
      customerSelection: {
        all: true,
      },
    },
  });

  if (!result.ok || !result.data) {
    return { ok: false, error: result.error || "Discount creation failed" };
  }

  const payload = result.data.discountCodeBasicCreate;
  if (payload.userErrors?.length) {
    const errMsg = payload.userErrors.map((e) => e.message).join("; ");
    console.error("[shopify admin] Discount error:", errMsg);
    return { ok: false, error: errMsg };
  }

  const discountId = payload.codeDiscountNode?.id || "";
  const code = payload.codeDiscountNode?.codeDiscount?.codes?.nodes?.[0]?.code || opts.code;

  return { ok: true, code, discountId };
}

/**
 * Create a percentage-off discount code.
 * Used for loyalty rewards (e.g., 100% off = free bag).
 */
export async function createPercentageDiscountCode(opts: {
  title: string;
  code: string;
  percentage: number; // 0-100
  usageLimit?: number;
  appliesOncePerCustomer?: boolean;
  endsAt?: string;
}): Promise<{ ok: boolean; code?: string; discountId?: string; error?: string }> {
  const now = new Date().toISOString();

  const result = await adminRequest<DiscountCreateResult>(DISCOUNT_CODE_CREATE, {
    basicCodeDiscount: {
      title: opts.title,
      code: opts.code,
      startsAt: now,
      endsAt: opts.endsAt || null,
      usageLimit: opts.usageLimit ?? 1,
      appliesOncePerCustomer: opts.appliesOncePerCustomer ?? true,
      customerGets: {
        value: {
          percentage: opts.percentage / 100,
        },
        items: {
          all: true,
        },
      },
      customerSelection: {
        all: true,
      },
    },
  });

  if (!result.ok || !result.data) {
    return { ok: false, error: result.error || "Discount creation failed" };
  }

  const payload = result.data.discountCodeBasicCreate;
  if (payload.userErrors?.length) {
    const errMsg = payload.userErrors.map((e) => e.message).join("; ");
    return { ok: false, error: errMsg };
  }

  const discountId = payload.codeDiscountNode?.id || "";
  const code = payload.codeDiscountNode?.codeDiscount?.codes?.nodes?.[0]?.code || opts.code;

  return { ok: true, code, discountId };
}

// ---------------------------------------------------------------------------
// Webhook registration
// ---------------------------------------------------------------------------

const WEBHOOK_CREATE = /* GraphQL */ `
  mutation webhookSubscriptionCreate(
    $topic: WebhookSubscriptionTopic!
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionCreate(
      topic: $topic
      webhookSubscription: $webhookSubscription
    ) {
      webhookSubscription {
        id
        topic
        endpoint {
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface WebhookCreateResult {
  webhookSubscriptionCreate: {
    webhookSubscription: {
      id: string;
      topic: string;
      endpoint: { callbackUrl: string };
    } | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
}

/**
 * Register a webhook subscription with Shopify.
 */
export async function registerWebhook(
  topic: string,
  callbackUrl: string,
): Promise<{ ok: boolean; webhookId?: string; error?: string }> {
  const result = await adminRequest<WebhookCreateResult>(WEBHOOK_CREATE, {
    topic,
    webhookSubscription: {
      callbackUrl,
      format: "JSON",
    },
  });

  if (!result.ok || !result.data) {
    return { ok: false, error: result.error || "Webhook registration failed" };
  }

  const payload = result.data.webhookSubscriptionCreate;
  if (payload.userErrors?.length) {
    const errMsg = payload.userErrors.map((e) => e.message).join("; ");
    return { ok: false, error: errMsg };
  }

  return {
    ok: true,
    webhookId: payload.webhookSubscription?.id,
  };
}

// ---------------------------------------------------------------------------
// Generate unique discount code strings
// ---------------------------------------------------------------------------

export function generateSubscriptionDiscountCode(email: string): string {
  const prefix = "SUB";
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(36).toUpperCase())
    .join("")
    .slice(0, 6);
  return `${prefix}-${suffix}`;
}

export function generateLoyaltyDiscountCode(email: string, tier: number): string {
  const prefix = tier >= 250 ? "REWARD3" : "REWARD1";
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(36).toUpperCase())
    .join("")
    .slice(0, 6);
  return `${prefix}-${suffix}`;
}
