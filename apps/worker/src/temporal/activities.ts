import { runFulfillment, type FulfillmentInput } from "../fulfillment/engine.js";

export async function runFulfillmentActivity(input: FulfillmentInput) {
  const result = await runFulfillment(input);
  return {
    workflowId: result.workflowId,
    completed: result.completed,
    paymentId: result.paymentId,
    crashed: result.crashed,
  };
}
