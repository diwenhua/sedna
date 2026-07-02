import type { MemoryStore } from "@sedna/memory";
import type { Worker } from "@sedna/protocol";
import type { WorkerJob } from "@sedna/protocol";

export function buildWorkerInventoryContext(store: MemoryStore): string {
  const workers = store.listWorkers().filter((worker) => worker.status !== "revoked");
  if (workers.length === 0) {
    return "No workers are registered.";
  }
  return workers.map((worker) => formatWorkerInventoryLine(store, worker)).join("\n");
}

export function findOnlineWorker(store: MemoryStore): Worker | undefined {
  return store.listWorkers().find((worker) => worker.status === "online");
}

export function listDispatchableWorkers(store: MemoryStore): Worker[] {
  return store.listWorkers().filter((worker) => {
    if (worker.status !== "online") {
      return false;
    }
    return store.listWorkerCapabilities(worker.id).some(
      (capability) => capability.enabled && capability.name === "agent.execute"
    );
  });
}

export async function waitForWorkerJob(
  store: MemoryStore,
  workerId: string,
  jobId: string,
  timeoutMs: number,
  pollMs: number
): Promise<WorkerJob> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const job = store.listWorkerJobs({ workerId }).find((item) => item.id === jobId);
    if (job?.status === "completed") {
      return job;
    }
    if (job?.status === "failed" || job?.status === "cancelled") {
      throw new Error(job.error ?? `Worker job ${job.status}`);
    }
    await sleep(pollMs);
  }
  throw new Error("Worker job timed out.");
}

function formatWorkerInventoryLine(store: MemoryStore, worker: Worker): string {
  const capabilities = store.listWorkerCapabilities(worker.id)
    .filter((capability) => capability.enabled)
    .map((capability) => formatWorkerCapabilityLabel(capability.name));
  return [
    `- ${worker.displayName} (${worker.id})`,
    `  status=${worker.status}`,
    `  last_heartbeat=${worker.lastSeenAt ?? "never"}`,
    `  environment=${worker.environment}`,
    `  host=${worker.hostName ?? "unknown"}`,
    `  os=${worker.os ?? "unknown"}`,
    `  enabled_capabilities=[${capabilities.join(", ") || "none"}]`,
    "  agent.execute runs a local worker agent with file read/write, directory listing, search, and shell commands."
  ].join("\n");
}

function formatWorkerCapabilityLabel(name: string): string {
  if (name === "agent.execute") {
    return "agent.execute (local files + shell)";
  }
  return name;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
