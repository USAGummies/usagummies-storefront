import type { WorkflowDefinition } from "@/lib/ops/workflow-engine";

export const monthEndCloseWorkflow: WorkflowDefinition = {
  id: "month_end_close",
  name: "Month-End Close",
  description: "Run QBO categorization, reconciliation, and the monthly close summary.",
  trigger: "manual",
  steps: [
    {
      id: "categorize_remaining",
      name: "Categorize Remaining Transactions",
      action_type: "batch_categorize_qbo",
      input: {
        mode: "execute",
      },
      requires_approval: true,
      on_failure: "human_review",
    },
    {
      id: "reconcile_transactions",
      name: "Reconcile Transactions",
      action_type: "reconcile_transactions",
      input: {
        startDate: "{{context.period_start}}",
        endDate: "{{context.period_end}}",
      },
      on_failure: "human_review",
    },
    {
      id: "run_monthly_close",
      name: "Run Monthly Close",
      action_type: "run_monthly_close",
      input: {
        period: "{{context.period}}",
      },
      on_failure: "abort",
    },
    {
      id: "post_summary",
      name: "Post Summary",
      action_type: "send_slack",
      input: {
        channel: "daily",
        message: "Month-end close complete for {{context.period}}. Revenue {{steps.run_monthly_close.result.report.pnl.revenue.total}}, net income {{steps.run_monthly_close.result.report.pnl.netIncome}}.",
      },
      on_failure: "skip",
    },
    {
      id: "notify_rene",
      name: "Notify Rene",
      action_type: "send_slack",
      input: {
        channel: "alerts",
        message: "Month-end close for {{context.period}} is ready. Investor loan review and final summary are available.",
      },
      requires_approval: true,
      on_failure: "skip",
    },
  ],
};
