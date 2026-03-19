import type { WorkflowDefinition } from "@/lib/ops/workflow-engine";

export const investorUpdateWorkflow: WorkflowDefinition = {
  id: "investor_update",
  name: "Investor Update",
  description: "Pull current financial context, create a Notion update, and draft the email to Rene.",
  trigger: "manual",
  steps: [
    {
      id: "pull_financials",
      name: "Pull Financials",
      action_type: "query_qbo",
      input: {
        query_type: "accounts",
      },
      on_failure: "abort",
    },
    {
      id: "pull_revenue",
      name: "Pull Revenue Context",
      action_type: "query_shopify_orders",
      input: {
        status: "open",
        days: 30,
        limit: 25,
      },
      on_failure: "skip",
    },
    {
      id: "create_update_page",
      name: "Create Update Page",
      action_type: "create_notion_page",
      input: {
        database: "meeting_notes",
        title: "Investor Update — {{context.period}}",
        content: "# Investor Update\n\n## Financials\n{{steps.pull_financials.result.message}}\n\n## Revenue Context\n{{steps.pull_revenue.result.message}}\n\n## Notes\n{{context.notes}}",
      },
      on_failure: "abort",
    },
    {
      id: "draft_email",
      name: "Draft Investor Email",
      action_type: "draft_email_reply",
      input: {
        to: "{{context.recipient_email}}",
        sender_name: "{{context.recipient_name}}",
        subject: "USA Gummies Investor Update — {{context.period}}",
        body: "Hi {{context.recipient_name}},\n\nI prepared the investor update in Notion.\n\nHighlights:\n{{steps.pull_financials.result.message}}\n\nRevenue context:\n{{steps.pull_revenue.result.message}}\n\nNotion page:\n{{steps.create_update_page.result.url}}\n\nBest,\nBen",
      },
      requires_approval: true,
      on_failure: "human_review",
    },
  ],
};
