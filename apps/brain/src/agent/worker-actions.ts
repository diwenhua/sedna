import type { MemoryStore } from "@sedna/memory";
import type { Worker, WorkerJob, WorkerPathScope } from "@sedna/protocol";

export type WorkerActionProgressEvent =
  | { type: "tool_status"; tool: string; phase: "search" | "fetch"; title: string; query?: string; url?: string }
  | { type: "tool_result"; tool: string; summary: string };

interface WorkerActionOptions {
  store: MemoryStore;
  ownerMessage: string;
  onProgress?: (event: WorkerActionProgressEvent) => void | Promise<void>;
  timeoutMs?: number;
  pollMs?: number;
}

interface WorkerActionPlan {
  capability: "worker.status" | "file.search" | "file.read" | "file.list";
  input: Record<string, unknown>;
  summary: string;
}

export function buildWorkerInventoryContext(store: MemoryStore): string {
  const workers = store.listWorkers().filter((worker) => worker.status !== "revoked");
  if (workers.length === 0) {
    return "No workers are registered.";
  }
  return workers.map((worker) => formatWorkerInventoryLine(store, worker)).join("\n");
}

export function buildWorkerStatusContext(store: MemoryStore): string {
  return [
    "Brain worker registry snapshot (from registration, recent heartbeats, and owner policy):",
    buildWorkerInventoryContext(store),
    "status=online means Brain received a recent heartbeat.",
    "status=offline means the worker is registered but has not heartbeated recently."
  ].join("\n");
}

export async function runWorkerActionFromMessage(options: WorkerActionOptions): Promise<string | undefined> {
  const lower = options.ownerMessage.toLowerCase();
  const worker = findOnlineWorker(options.store);

  if (worker) {
    const plan = buildWorkerActionPlan(options.store, worker, options.ownerMessage);
    if (plan) {
      return executeWorkerJobPlan(options, worker, plan);
    }
  }

  if (looksLikeWorkerInventoryRequest(lower)) {
    if (worker && hasWorkerStatusCapability(options.store, worker.id)) {
      return executeWorkerJobPlan(options, worker, {
        capability: "worker.status",
        input: {},
        summary: "Checking worker status"
      });
    }
    return buildWorkerStatusContext(options.store);
  }

  if (!worker) {
    if (looksLikeFileWorkerRequest(lower)) {
      return buildWorkerUnavailableContext(options.store, "no_online_worker");
    }
    return undefined;
  }

  if (looksLikeFileWorkerRequest(lower)) {
    return buildWorkerUnavailableContext(options.store, "no_matching_plan", worker);
  }

  return undefined;
}

async function executeWorkerJobPlan(
  options: WorkerActionOptions,
  worker: Worker,
  plan: WorkerActionPlan
): Promise<string> {
  await options.onProgress?.({
    type: "tool_status",
    tool: plan.capability,
    phase: plan.capability === "file.search" || plan.capability === "file.list" ? "search" : "fetch",
    title: plan.summary,
    query: plan.capability === "file.search" ? String(plan.input.query ?? "") : undefined,
    url: plan.capability === "file.read" || plan.capability === "file.list" ? String(plan.input.path ?? "") : undefined
  });
  const job = options.store.createWorkerJob({
    workerId: worker.id,
    capability: plan.capability,
    input: plan.input,
    timeoutMs: options.timeoutMs ?? 15_000
  });
  const completed = await waitForWorkerJob(
    options.store,
    worker.id,
    job.id,
    options.timeoutMs ?? 15_000,
    options.pollMs ?? 250
  );
  const context = formatWorkerContext(worker, completed);
  await options.onProgress?.({
    type: "tool_result",
    tool: plan.capability,
    summary: summarizeWorkerJob(completed)
  });
  return context;
}

function findOnlineWorker(store: MemoryStore): Worker | undefined {
  return store.listWorkers().find((worker) => worker.status === "online");
}

function buildWorkerActionPlan(store: MemoryStore, worker: Worker, message: string): WorkerActionPlan | undefined {
  const lower = message.toLowerCase();
  const scopes = mostSpecificPathScopes(store.listWorkerPathScopes(worker.id).filter((scope) => scope.enabled && scope.mode === "read_only"));
  if (scopes.length === 0) {
    return undefined;
  }
  const capabilities = store.listWorkerCapabilities(worker.id).filter((capability) => capability.enabled && capability.readOnly);
  const hasList = capabilities.some((capability) => capability.name === "file.list");
  const hasSearch = capabilities.some((capability) => capability.name === "file.search");
  const hasRead = capabilities.some((capability) => capability.name === "file.read");

  const explicitPath = extractAbsolutePath(message);
  if (hasList && looksLikeListRequest(lower)) {
    const listPath = explicitPath ?? scopes[0]?.path;
    if (!listPath) {
      return undefined;
    }
    return {
      capability: "file.list",
      input: {
        path: listPath,
        max_entries: 100
      },
      summary: "Listing local directory through worker"
    };
  }

  if (hasRead && explicitPath && looksLikeReadRequest(lower)) {
    return {
      capability: "file.read",
      input: { path: explicitPath, max_bytes: 200000 },
      summary: "Reading local file through worker"
    };
  }

  if (hasSearch && looksLikeSearchRequest(lower)) {
    return {
      capability: "file.search",
      input: {
        query: extractSearchQuery(message),
        paths: scopes.map((scope) => scope.path),
        max_results: 10
      },
      summary: "Searching local files through worker"
    };
  }

  return undefined;
}

function hasWorkerStatusCapability(store: MemoryStore, workerId: string): boolean {
  return store.listWorkerCapabilities(workerId).some(
    (capability) => capability.enabled && capability.name === "worker.status"
  );
}

function looksLikeWorkerInventoryRequest(lower: string): boolean {
  if (looksLikeFileWorkerRequest(lower)) {
    return false;
  }
  const withoutPaths = lower.replace(/\/[^\s"'，。；：,;:？?]+/g, " ");
  if (/\bworkers?\b|执行节点|工作节点/.test(withoutPaths)
    && /有哪些|列出|列表|可用|在线|离线|状态|list|available|status|registered|配对|在吗|在不在|是否|实时|heartbeat|心跳|活着|连通/.test(withoutPaths)) {
    return true;
  }
  return /\bworkers?\b.*(在线|状态|offline|online)/.test(withoutPaths)
    || /(在线|状态|offline|online).*\bworkers?\b/.test(withoutPaths);
}

function looksLikeFileWorkerRequest(lower: string): boolean {
  return looksLikeSearchRequest(lower) || looksLikeListRequest(lower) || looksLikeReadRequest(lower);
}

function buildWorkerUnavailableContext(
  store: MemoryStore,
  reason: "no_online_worker" | "no_matching_plan",
  worker?: Worker
): string {
  const inventory = buildWorkerInventoryContext(store);
  if (reason === "no_online_worker") {
    return [
      "Local worker action was not executed because no worker is currently online.",
      "Start the worker process and ensure it is sending heartbeats before local file actions can run.",
      "Registered workers:",
      inventory
    ].join("\n");
  }
  return [
    `Local worker action was not executed for ${worker?.displayName ?? "the selected worker"}.`,
    "Check that the worker is online and that Brain policy enables the requested capability with at least one allowed read-only path.",
    "Registered workers:",
    inventory
  ].join("\n");
}

function formatWorkerInventoryLine(store: MemoryStore, worker: Worker): string {
  const capabilities = store.listWorkerCapabilities(worker.id)
    .filter((capability) => capability.enabled)
    .map((capability) => capability.name);
  const paths = store.listWorkerPathScopes(worker.id)
    .filter((scope) => scope.enabled)
    .map((scope) => scope.path);
  return [
    `- ${worker.displayName} (${worker.id})`,
    `  status=${worker.status}`,
    `  last_heartbeat=${worker.lastSeenAt ?? "never"}`,
    `  environment=${worker.environment}`,
    `  host=${worker.hostName ?? "unknown"}`,
    `  os=${worker.os ?? "unknown"}`,
    `  enabled_capabilities=[${capabilities.join(", ") || "none"}]`,
    `  allowed_paths=[${paths.join(", ") || "none"}]`
  ].join("\n");
}

function looksLikeSearchRequest(lower: string): boolean {
  return /搜索|查找|找一下|找找|search|find/.test(lower)
    && /本地|文件|目录|folder|file|local|readme|package|doc|文档/.test(lower);
}

function looksLikeListRequest(lower: string): boolean {
  return /列出|列一下|有哪些文件|目录下面|目录下|看看.*文件|文件列表|list files|show files|directory listing/.test(lower)
    && /本地|文件|目录|folder|directory|local|\//.test(lower);
}

function looksLikeReadRequest(lower: string): boolean {
  return /读取|打开|看看|读一下|read|open|show/.test(lower)
    && /本地|文件|file|local|\//.test(lower);
}

function extractAbsolutePath(message: string): string | undefined {
  const filePath = message.match(/(?:\/[^\s"'，。；：,;:？?]+)+\.(?:md|txt|json|ts|tsx|js|jsx|yml|yaml|toml|lock|csv|pdf|docx|xlsx)/i)?.[0];
  if (filePath) {
    return filePath;
  }
  return message.match(/(?:\/[^\s"'，。；：,;:？?]+)+/)?.[0];
}

function extractSearchQuery(message: string): string {
  const quoted = message.match(/["'“”‘’]([^"'“”‘’]+)["'“”‘’]/)?.[1]?.trim();
  if (quoted) {
    return quoted;
  }
  const filename = message.match(/[A-Za-z0-9_.-]+\.(?:md|txt|json|ts|tsx|js|jsx|yml|yaml|toml|lock)/)?.[0];
  if (filename) {
    return filename;
  }
  const knownToken = message.match(/\b(?:README|package|pnpm-lock|AGENTS|CHANGELOG|LICENSE)\b/i)?.[0];
  if (knownToken) {
    return knownToken;
  }
  return message.replace(/帮我|请|在本地|本地|搜索|查找|找一下|找找|文件|目录|search|find|local|file|folder/gi, " ").trim() || message;
}

async function waitForWorkerJob(
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

function formatWorkerContext(worker: Worker, job: WorkerJob): string {
  return [
    `worker_id: ${worker.id}`,
    `worker_name: ${worker.displayName}`,
    `capability: ${job.capability}`,
    `status: ${job.status}`,
    "result:",
    JSON.stringify(job.result ?? {}, null, 2)
  ].join("\n");
}

function summarizeWorkerJob(job: WorkerJob): string {
  if (job.capability === "worker.status") {
    return "Worker status refreshed";
  }
  if (job.capability === "file.search") {
    const matches = Array.isArray(job.result?.matches) ? job.result.matches.length : 0;
    return `${matches} local file match${matches === 1 ? "" : "es"}`;
  }
  if (job.capability === "file.list") {
    const entries = Array.isArray(job.result?.entries) ? job.result.entries.length : 0;
    return `${entries} local entr${entries === 1 ? "y" : "ies"}`;
  }
  if (job.capability === "file.read") {
    const size = typeof job.result?.size === "number" ? job.result.size : 0;
    return `${size} byte${size === 1 ? "" : "s"} read`;
  }
  return "Worker job completed";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mostSpecificPathScopes(scopes: WorkerPathScope[]): WorkerPathScope[] {
  if (scopes.length <= 1) {
    return scopes;
  }
  const sorted = [...scopes].sort((a, b) => b.path.length - a.path.length);
  return [sorted[0] as WorkerPathScope];
}
