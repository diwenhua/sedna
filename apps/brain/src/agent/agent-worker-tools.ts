import type { MemoryStore } from "@sedna/memory";
import type { Worker, WorkerJob } from "@sedna/protocol";
import { findOnlineWorker, listDispatchableWorkers, waitForWorkerJob } from "./worker-actions.js";

interface FunctionToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface WorkerToolProgress {
  tool: string;
  phase: "search" | "fetch" | "tool";
  title: string;
  query?: string;
  url?: string;
}

export function buildWorkerAgentToolDefinitions(store: MemoryStore): FunctionToolDefinition[] {
  const workers = listDispatchableWorkers(store);
  if (workers.length === 0) {
    return [];
  }

  const workerLines = workers.map((worker) => `- ${worker.displayName} (${worker.id})`).join("\n");

  return [{
    type: "function",
    name: "worker_dispatch_task",
    description: `Dispatch a natural-language task to an online worker agent (agent.execute). The worker runs a local agent with file read/write, directory listing/search, and shell commands, then returns structured results. Use this for local file creation, edits, inspection, and command execution. Available workers:\n${workerLines}`,
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "What the worker should accomplish on its local device." },
        worker_id: { type: "string", description: "Optional worker id. Defaults to the best matching online worker." },
        context: { type: "string", description: "Optional extra context from the conversation." }
      },
      required: ["goal"],
      additionalProperties: false
    }
  }];
}

export async function executeWorkerDispatchTask(
  store: MemoryStore,
  args: Record<string, unknown>,
  options?: { timeoutMs?: number; pollMs?: number; onProgress?: (event: WorkerToolProgress) => void | Promise<void> }
): Promise<Record<string, unknown>> {
  const goal = typeof args.goal === "string" ? args.goal.trim() : "";
  if (goal.length === 0) {
    return { success: false, error: "worker_dispatch_task requires goal." };
  }

  const worker = resolveDispatchWorker(store, typeof args.worker_id === "string" ? args.worker_id : undefined);
  if (!worker) {
    return { success: false, error: "No online worker with agent.execute is available." };
  }

  await options?.onProgress?.({
    tool: "worker_dispatch_task",
    phase: "tool",
    title: `Dispatching task to ${worker.displayName}`,
    query: goal
  });

  return runWorkerAgentJob(store, worker, {
    goal,
    context: typeof args.context === "string" ? args.context : undefined
  }, options);
}

function resolveDispatchWorker(store: MemoryStore, workerId?: string): Worker | undefined {
  const workers = listDispatchableWorkers(store);
  if (workers.length === 0) {
    return undefined;
  }
  if (workerId) {
    return workers.find((worker) => worker.id === workerId);
  }
  return workers[0];
}

async function runWorkerAgentJob(
  store: MemoryStore,
  worker: Worker,
  input: { goal: string; context?: string },
  options?: { timeoutMs?: number; pollMs?: number }
): Promise<Record<string, unknown>> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  try {
    const job = store.createWorkerJob({
      workerId: worker.id,
      capability: "agent.execute",
      input,
      timeoutMs
    });
    const completed = await waitForWorkerJob(
      store,
      worker.id,
      job.id,
      timeoutMs,
      options?.pollMs ?? 500
    );
    const result = completed.result ?? {};
    return {
      success: result.success !== false,
      worker_id: worker.id,
      worker_name: worker.displayName,
      capability: "agent.execute",
      job_id: completed.id,
      summary: typeof result.summary === "string" ? result.summary : undefined,
      answer: typeof result.answer === "string" ? result.answer : undefined,
      steps: Array.isArray(result.steps) ? result.steps : [],
      error: typeof result.error === "string" ? result.error : undefined
    };
  } catch (error) {
    return {
      success: false,
      worker_id: worker.id,
      worker_name: worker.displayName,
      capability: "agent.execute",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function summarizeWorkerDispatchTask(observation: Record<string, unknown>): string {
  if (observation.success === false) {
    return typeof observation.error === "string" ? observation.error : "Worker task failed.";
  }
  if (typeof observation.summary === "string" && observation.summary.length > 0) {
    return observation.summary.slice(0, 120);
  }
  const steps = Array.isArray(observation.steps) ? observation.steps.length : 0;
  return steps > 0 ? `Worker completed with ${steps} step${steps === 1 ? "" : "s"}` : "Worker task completed";
}

export function normalizeWorkerAgentJobResult(job: WorkerJob): Record<string, unknown> {
  const result = job.result ?? {};
  return {
    success: result.success !== false,
    summary: result.summary,
    answer: result.answer,
    steps: result.steps,
    error: result.error
  };
}
