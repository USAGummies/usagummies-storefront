/**
 * Communication types for the unified inbox.
 *
 * Covers: Email (Gmail), Slack, B2B pipeline notes,
 * Shopify customer inquiries, and Amazon buyer messages.
 */

export type CommSource =
  | "email"
  | "slack"
  | "b2b_pipeline"
  | "shopify_customer"
  | "amazon_buyer";

export type CommPriority = "high" | "normal" | "low";

export type CommCategory =
  | "support"
  | "sales"
  | "operations"
  | "finance"
  | "other";

export type CommMessage = {
  id: string;
  source: CommSource;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  read: boolean;
  threadId?: string;
  priority: CommPriority;
  category: CommCategory;
};

export type CommThread = {
  id: string;
  source: CommSource;
  subject: string;
  messages: CommMessage[];
  lastActivity: string;
  status: "open" | "pending" | "resolved";
};

export type InboxSummary = {
  messages: CommMessage[];
  unreadCount: {
    email: number;
    slack: number;
    b2b: number;
    shopify: number;
    amazon: number;
    total: number;
  };
  lastUpdated: string;
};
