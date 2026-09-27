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

export function buildTaskManagementToolDefinitions(): FunctionToolDefinition[] {
  return [
    {
      type: "function",
      name: "task_create",
      description: "Create a persistent, cross-device task. The task is stored centrally in the Brain, queued as pending, and the next capable worker device (office laptop, home server, etc.) claims and executes it automatically. Progress is checkpointed so the task can pause on one device and resume on another. Use this instead of worker_dispatch_task for long-running work or work that should follow the owner across devices.",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string", description: "What the task should accomplish. Device-independent; do not reference local paths unless you pass them via context." },
          context: { type: "string", description: "Optional extra context, constraints, or handoff notes for the executing worker." },
          needs: {
            type: "array",
            description: "Optional capability requirements. Each entry names a worker capability (e.g. agent.execute) that must be satisfied by the claiming worker.",
            items: {
              type: "object",
              properties: {
                capability: { type: "string" },
                optional: { type: "boolean" }
              },
              required: ["capability"],
              additionalProperties: false
            }
          }
        },
        required: ["goal"],
        additionalProperties: false
      }
    },
    {
      type: "function",
      name: "task_status",
      description: "Check the status, progress checkpoints, and artifacts of a persistent task. Omit task_id to list recent tasks.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Optional task id returned by task_create." }
        },
        additionalProperties: false
      }
    },
    {
      type: "function",
      name: "task_pause",
      description: "Pause a running or pending task. Generates a handoff summary from its checkpoints so any capable device can resume it later with full context.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" }
        },
        required: ["task_id"],
        additionalProperties: false
      }
    },
    {
      type: "function",
      name: "task_resume",
      description: "Resume a paused or failed task. It is re-queued as pending and will be claimed by the next capable worker device, which continues from the last checkpoint.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" }
        },
        required: ["task_id"],
        additionalProperties: false
      }
    }
  ];
}

export async function executeTaskManagementTool(
  store: MemoryStore,
  toolName: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (toolName === "task_create") {
    const goal = typeof args.goal === "string" ? args.goal.trim() : "";
    if (goal.length === 0) {
      return { success: false, error: "task_create requires goal." };
    }
    const needs = Array.isArray(args.needs)
      ? args.needs
        .filter((item): item is { capability: string; optional?: boolean } =>
          typeof item === "object" && item !== null && typeof (item as { capability?: unknown }).capability === "string")
        .map((item) => ({ capability: item.capability, optional: item.optional === true }))
      : [];
    const task = store.createTask({
      goal,
      context: typeof args.context === "string" ? args.context : undefined,
      needs
    });
    return {
      success: true,
      task_id: task.id,
      status: task.status,
      note: "Task queued. The next capable worker device will claim it automatically. Use task_status to track progress."
    };
  }

  if (toolName === "task_status") {
    const taskId = typeof args.task_id === "string" ? args.task_id.trim() : "";
    if (taskId) {
      const task = store.getTask(taskId);
      if (!task) {
        return { success: false, error: `Task not found: ${taskId}` };
      }
      const checkpoints = store.listTaskCheckpoints(taskId);
      return {
        success: true,
        task,
        checkpoint_count: checkpoints.length,
        recent_checkpoints: checkpoints.slice(-5).map((checkpoint) => `${checkpoint.summary || checkpoint.kind}`),
        artifacts: store.listTaskArtifacts(taskId).map((artifact) => ({ id: artifact.id, name: artifact.name, sizeBytes: artifact.sizeBytes }))
      };
    }
    const tasks = store.listTasks().slice(0, 10);
    return {
      success: true,
      tasks: tasks.map((task) => ({
        task_id: task.id,
        goal: task.goal,
        status: task.status,
        assigned_worker_id: task.assignedWorkerId
      }))
    };
  }

  if (toolName === "task_pause") {
    const taskId = typeof args.task_id === "string" ? args.task_id.trim() : "";
    if (!taskId) {
      return { success: false, error: "task_pause requires task_id." };
    }
    const task = store.pauseTask(taskId);
    return { success: true, task_id: task.id, status: task.status, handoff_summary: task.handoffSummary };
  }

  if (toolName === "task_resume") {
    const taskId = typeof args.task_id === "string" ? args.task_id.trim() : "";
    if (!taskId) {
      return { success: false, error: "task_resume requires task_id." };
    }
    const task = store.resumeTask(taskId);
    return { success: true, task_id: task.id, status: task.status, note: "Task re-queued; the next capable worker will claim it and resume from the last checkpoint." };
  }

  return { success: false, error: `Unsupported task tool: ${toolName}` };
}

export function summarizeTaskManagementTool(observation: Record<string, unknown>): string {
  if (observation.success === false) {
    return typeof observation.error === "string" ? observation.error : "Task tool failed.";
  }
  const status = typeof observation.status === "string" ? observation.status : "";
  if (typeof observation.task_id === "string") {
    return `Task ${observation.task_id}${status ? ` ${status}` : ""}`;
  }
  const count = Array.isArray(observation.tasks) ? observation.tasks.length : 0;
  return `${count} task${count === 1 ? "" : "s"}`;
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
