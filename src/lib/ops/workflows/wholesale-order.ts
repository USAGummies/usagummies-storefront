import type { WorkflowDefinition } from "@/lib/ops/workflow-engine";

export const wholesaleOrderFulfillment: WorkflowDefinition = {
  id: "wholesale_order_fulfillment",
  name: "Wholesale Order Fulfillment",
  description: "Turn a won wholesale order into a draft order, invoice, and outbound follow-up.",
  trigger: "manual",
  steps: [
    {
      id: "capture_order_brief",
      name: "Capture Order Brief",
      action_type: "create_brain_entry",
      input: {
        title: "Wholesale order request — {{context.customer_name}}",
        text: "Workflow started for {{context.customer_name}} ({{context.company_name}}). Quantity {{context.quantity}} at ${{context.unit_price}} per unit. Customer email: {{context.customer_email}}.",
        category: "sales",
        department: "sales_and_growth",
        entry_type: "summary",
        tags: ["workflow", "wholesale_order"],
      },
      on_failure: "skip",
    },
    {
      id: "check_recent_shopify_context",
      name: "Check Shopify Context",
      action_type: "query_shopify_orders",
      input: {
        status: "open",
        days: 30,
        limit: 10,
      },
      on_failure: "skip",
    },
    {
      id: "create_draft_order",
      name: "Create Draft Order",
      action_type: "create_wholesale_draft_order",
      input: {
        customer_name: "{{context.customer_name}}",
        customer_email: "{{context.customer_email}}",
        company_name: "{{context.company_name}}",
        note: "{{context.note}}",
        quantity: "$context.quantity",
        unit_price: "$context.unit_price",
        product_title: "{{context.product_title}}",
      },
      requires_approval: true,
      on_failure: "abort",
    },
    {
      id: "create_invoice",
      name: "Create Invoice",
      action_type: "create_qbo_invoice",
      input: {
        customerName: "{{context.customer_name}}",
        customerEmail: "{{context.customer_email}}",
        memo: "Wholesale order workflow for {{context.company_name}}",
        lineItems: [
          {
            description: "{{context.product_title}}",
            quantity: "$context.quantity",
            unitPrice: "$context.unit_price",
          },
        ],
      },
      on_failure: "abort",
    },
    {
      id: "send_invoice_email",
      name: "Send Invoice Email",
      action_type: "send_email",
      input: {
        to: "{{context.customer_email}}",
        subject: "Invoice for {{context.company_name}}",
        body: "Hi {{context.customer_name}},\n\nYour wholesale order is ready. I created the invoice and attached the payment link below.\n\nInvoice: {{steps.create_invoice.result.invoiceUrl}}\nDraft order: {{steps.create_draft_order.result.invoiceUrl}}\n\nBest,\nBen",
        allow_external: true,
      },
      requires_approval: true,
      on_failure: "human_review",
    },
    {
      id: "update_pipeline",
      name: "Update Pipeline",
      action_type: "update_notion",
      input: {
        page_id: "{{context.pipeline_page_id}}",
        properties: {
          Status: "Invoiced",
        },
      },
      condition: "Boolean(context.pipeline_page_id)",
      on_failure: "skip",
    },
    {
      id: "notify_team",
      name: "Notify Team",
      action_type: "send_slack",
      input: {
        channel: "pipeline",
        message: "Workflow complete: wholesale order processed for {{context.customer_name}} / {{context.company_name}} — {{context.quantity}} units at ${{context.unit_price}}.",
      },
      on_failure: "skip",
    },
  ],
};
