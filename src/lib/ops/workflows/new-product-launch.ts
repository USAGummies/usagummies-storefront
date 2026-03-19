import type { WorkflowDefinition } from "@/lib/ops/workflow-engine";

export const newProductLaunchWorkflow: WorkflowDefinition = {
  id: "new_product_launch",
  name: "New Product Launch",
  description: "Create the initial launch artifact set for a new product or flavor.",
  trigger: "manual",
  steps: [
    {
      id: "create_shopify_product",
      name: "Create Shopify Product Draft",
      action_type: "create_shopify_product_draft",
      input: {
        title: "{{context.product_title}}",
        description: "{{context.description}}",
        product_type: "{{context.product_type}}",
        tags: "{{context.tags}}",
      },
      requires_approval: true,
      on_failure: "abort",
    },
    {
      id: "log_launch_plan",
      name: "Log Launch Plan",
      action_type: "create_notion_page",
      input: {
        database: "content_drafts",
        title: "Launch Checklist — {{context.product_title}}",
        content: "# Launch Checklist\n\nProduct draft:\n{{steps.create_shopify_product.result.message}}\n\nLaunch notes:\n{{context.launch_notes}}",
      },
      on_failure: "skip",
    },
    {
      id: "set_inventory",
      name: "Set Initial Inventory",
      action_type: "update_shopify_inventory",
      input: {
        variantId: "{{context.variant_id}}",
        adjustment: "$context.initial_stock",
        reason: "initial_product_launch",
      },
      condition: "Boolean(context.variant_id) && Number(context.initial_stock || 0) !== 0",
      on_failure: "human_review",
    },
    {
      id: "create_qbo_followup",
      name: "Create QBO Follow-up Task",
      action_type: "create_task",
      input: {
        title: "Create QBO inventory item for {{context.product_title}}",
        description: "Workflow launch checklist follow-up for {{context.product_title}}.",
        priority: "high",
      },
      on_failure: "skip",
    },
    {
      id: "notify_team",
      name: "Notify Team",
      action_type: "send_slack",
      input: {
        channel: "alerts",
        message: "Launch workflow ready for {{context.product_title}}. Shopify draft and launch notes are prepared.",
      },
      on_failure: "skip",
    },
  ],
};
