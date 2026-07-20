/**
 * Temporal workflow definition for order fulfillment.
 * Activities perform effects; workflow orchestrates durable history.
 */
import { proxyActivities } from "@temporalio/workflow";

export interface FulfillmentWorkflowInput {
  principalId: string;
  orderId: string;
  amountCents: number;
  currency: string;
  sku: string;
  quantity: number;
  emailTo: string;
  scenarioId?: string;
}

const activities = proxyActivities<{
  runFulfillmentActivity: (
    input: FulfillmentWorkflowInput,
  ) => Promise<{ workflowId: string; completed: boolean; paymentId?: string }>;
}>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 1 },
});

export async function orderFulfillmentWorkflow(
  input: FulfillmentWorkflowInput,
): Promise<{ workflowId: string; completed: boolean; paymentId?: string }> {
  return activities.runFulfillmentActivity(input);
}
