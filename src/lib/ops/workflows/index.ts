import type { WorkflowDefinition } from "@/lib/ops/workflow-engine";
import { wholesaleOrderFulfillment } from "@/lib/ops/workflows/wholesale-order";
import { monthEndCloseWorkflow } from "@/lib/ops/workflows/month-end-close";
import { newProductLaunchWorkflow } from "@/lib/ops/workflows/new-product-launch";
import { investorUpdateWorkflow } from "@/lib/ops/workflows/investor-update";

export const WORKFLOWS: Record<string, WorkflowDefinition> = {
  wholesale_order_fulfillment: wholesaleOrderFulfillment,
  month_end_close: monthEndCloseWorkflow,
  new_product_launch: newProductLaunchWorkflow,
  investor_update: investorUpdateWorkflow,
};
