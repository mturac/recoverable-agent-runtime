import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./temporal/activities.js";
import { domainHealth } from "@rar/domain";

async function main(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const namespace =
    process.env.TEMPORAL_NAMESPACE ?? "recoverable-agent-runtime";
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? "rar-fulfillment";

  console.log(
    JSON.stringify({
      ok: true,
      service: "worker",
      domain: domainHealth(),
      temporal: { address, namespace, taskQueue },
    }),
  );

  if (process.env.TEMPORAL_DISABLED === "1") {
    console.log("TEMPORAL_DISABLED=1 — worker idle (engine still usable via demo)");
    return;
  }

  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath: new URL("./temporal/workflows.js", import.meta.url).pathname,
    activities,
  });
  await worker.run();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
