#!/usr/bin/env node
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeWorkerCapability, parseAllowedPaths, type WorkerRuntimePolicy } from "./capabilities.js";
import type { WorkerAgentLlmConfig } from "./agent-loop.js";

interface WorkerState {
  workerId?: string;
  credential?: string;
}

interface WorkerJob {
  id: string;
  capability: string;
  input: Record<string, unknown>;
  timeoutMs: number;
}

interface WorkerPathScopePolicy {
  id: string;
  workerId: string;
  label: string;
  path: string;
  mode: "read_only" | "read_write";
  enabled: boolean;
}

interface WorkerPolicyResponse {
  capabilities: Array<{ name: string; enabled: boolean }>;
  pathScopes: WorkerPathScopePolicy[];
}

let cachedPolicy: WorkerPolicyResponse | null = null;

const command = process.argv[2] ?? "run";

if (command === "status") {
  printStatus();
} else if (command === "capabilities") {
  printCapabilities();
} else if (command === "pair") {
  void pairWorker().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
} else if (command === "unpair") {
  void unpairWorker().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
} else if (command === "run") {
  void runWorker().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
} else {
  console.error("Sedna worker supports: pair, unpair, run, status, capabilities");
  process.exitCode = 1;
}

function printStatus(): void {
  console.log(JSON.stringify({
    name: process.env.SEDNA_WORKER_NAME ?? os.hostname(),
    brainUrl: brainUrl(),
    allowedPaths: allowedPaths(),
    capabilities: capabilityDeclarations().map((capability) => capability.name)
  }, null, 2));
}

function printCapabilities(): void {
  console.log(JSON.stringify(capabilityDeclarations(), null, 2));
}

async function runWorker(): Promise<void> {
  const state = await loadState();
  if (!state.workerId || !state.credential) {
    throw new Error("Worker is not paired. Run: pnpm dev:worker pair --code <PAIR-CODE>");
  }
  const workerId = state.workerId;
  const credential = state.credential;
  await syncCapabilities(workerId, credential);
  await syncPolicy(workerId, credential);

  const heartbeatMs = intEnv("SEDNA_WORKER_HEARTBEAT_MS", 15000);
  const pollMs = intEnv("SEDNA_WORKER_POLL_MS", 2000);
  await heartbeat(workerId, credential);
  setInterval(() => void heartbeat(workerId, credential).catch(logError), heartbeatMs);
  setInterval(() => void pollOnce(workerId, credential).catch(logError), pollMs);
  console.log(`Sedna worker online: ${workerId}`);
}

async function pairWorker(): Promise<void> {
  const code = readCodeArg();
  if (!code) {
    throw new Error("Missing pair code. Usage: pnpm dev:worker pair --code <PAIR-CODE>");
  }
  const response = await api<{ worker: { id: string }; credential: string }>("/api/workers/pair", {
    method: "POST",
    body: JSON.stringify({
      code,
      display_name: process.env.SEDNA_WORKER_NAME ?? os.hostname(),
      environment_type: "local",
      host_name: os.hostname(),
      os: `${os.type()} ${os.release()}`,
      metadata: { arch: os.arch(), platform: os.platform() },
      capabilities: capabilityDeclarations(),
      path_scopes: []
    })
  });
  await saveState({ workerId: response.worker.id, credential: response.credential });
  console.log(`Sedna worker paired: ${response.worker.id}`);
}

async function unpairWorker(): Promise<void> {
  try {
    await unlink(statePath());
  } catch {
    // Missing state is already unpaired.
  }
  console.log("Sedna worker local pairing state removed.");
}

async function heartbeat(workerId: string, credential: string): Promise<void> {
  await api(`/api/workers/${encodeURIComponent(workerId)}/heartbeat`, {
    method: "POST",
    credential,
    body: JSON.stringify({
      metadata: { pid: process.pid, uptime: process.uptime() }
    })
  });
  await syncPolicy(workerId, credential);
}

async function syncPolicy(workerId: string, credential: string): Promise<void> {
  cachedPolicy = await api<WorkerPolicyResponse>(`/api/workers/${encodeURIComponent(workerId)}/policy`, { credential });
}

async function syncCapabilities(workerId: string, credential: string): Promise<void> {
  await api(`/api/workers/${encodeURIComponent(workerId)}/capabilities/sync`, {
    method: "POST",
    credential,
    body: JSON.stringify({ capabilities: capabilityDeclarations() })
  });
}

async function pollOnce(workerId: string, credential: string): Promise<void> {
  const jobs = await api<WorkerJob[]>(`/api/workers/${encodeURIComponent(workerId)}/jobs/pending`, { credential });
  for (const job of jobs) {
    await runJob(workerId, credential, job);
  }
}

async function runJob(workerId: string, credential: string, job: WorkerJob): Promise<void> {
  await api(`/api/workers/${encodeURIComponent(workerId)}/jobs/${encodeURIComponent(job.id)}/start`, { method: "POST", credential });
  try {
    const result = await withTimeout(
      executeWorkerCapability(job.capability, job.input, {
        policy: runtimePolicy(),
        fetchAgentLlm: () => fetchAgentLlm(workerId, credential),
        fetchImpl: fetch
      }),
      job.timeoutMs
    );
    await api(`/api/workers/${encodeURIComponent(workerId)}/jobs/${encodeURIComponent(job.id)}/complete`, {
      method: "POST",
      credential,
      body: JSON.stringify({ result })
    });
  } catch (error) {
    await api(`/api/workers/${encodeURIComponent(workerId)}/jobs/${encodeURIComponent(job.id)}/fail`, {
      method: "POST",
      credential,
      body: JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
    });
  }
}

function capabilityDeclarations() {
  return [
    {
      name: "worker.status",
      risk: "low",
      read_only: true,
      requires_confirmation: false,
      enabled: true,
      allowed_scopes: ["self"],
      input_schema: {},
      output_schema: {}
    },
    {
      name: "agent.execute",
      risk: "high",
      read_only: false,
      requires_confirmation: false,
      enabled: true,
      allowed_scopes: ["self"],
      input_schema: {
        type: "object",
        properties: {
          goal: { type: "string" },
          context: { type: "string" }
        },
        required: ["goal"]
      },
      output_schema: { type: "object" }
    }
  ];
}

function runtimePolicy(): WorkerRuntimePolicy {
  const optionalRoots = allowedPaths();
  return {
    allowedPaths: optionalRoots,
    maxReadBytes: intEnv("SEDNA_WORKER_MAX_READ_BYTES", 200000),
    maxWriteBytes: intEnv("SEDNA_WORKER_MAX_WRITE_BYTES", 500000),
    maxSearchResults: intEnv("SEDNA_WORKER_MAX_SEARCH_RESULTS", 50),
    maxListEntries: intEnv("SEDNA_WORKER_MAX_LIST_ENTRIES", 200),
    maxCommandMs: intEnv("SEDNA_WORKER_MAX_COMMAND_MS", 120000),
    maxCommandOutputBytes: intEnv("SEDNA_WORKER_MAX_COMMAND_OUTPUT_BYTES", 200000)
  };
}

function allowedPaths(): string[] {
  return parseAllowedPaths(process.env.SEDNA_WORKER_ALLOWED_PATHS);
}

function brainUrl(): string {
  return (process.env.SEDNA_BRAIN_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
}

async function fetchAgentLlm(workerId: string, credential: string): Promise<WorkerAgentLlmConfig> {
  return api<WorkerAgentLlmConfig>(`/api/workers/${encodeURIComponent(workerId)}/agent-llm`, { credential });
}

async function api<T = unknown>(pathname: string, init: RequestInit & { credential?: string } = {}): Promise<T> {
  const { credential, ...requestInit } = init;
  const headers: Record<string, string> = {
    ...(credential ? { Authorization: `Bearer ${credential}` } : {})
  };
  if (init.body) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${brainUrl()}${pathname}`, {
    ...requestInit,
    headers: {
      ...headers,
      ...requestInit.headers
    }
  });
  if (!response.ok) {
    throw new Error(`Brain API request failed: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

function readCodeArg(): string | undefined {
  const codeIndex = process.argv.indexOf("--code");
  if (codeIndex >= 0) {
    return process.argv[codeIndex + 1];
  }
  return process.env.SEDNA_WORKER_PAIR_CODE;
}

async function loadState(): Promise<WorkerState> {
  try {
    return JSON.parse(await readFile(statePath(), "utf8")) as WorkerState;
  } catch {
    return {};
  }
}

async function saveState(state: WorkerState): Promise<void> {
  await mkdir(path.dirname(statePath()), { recursive: true });
  await writeFile(statePath(), JSON.stringify(state, null, 2), "utf8");
}

function statePath(): string {
  return process.env.SEDNA_WORKER_STATE_PATH ?? path.join(process.cwd(), ".local", "worker-state.json");
}

function intEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("Worker job timed out.")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function logError(error: unknown): void {
  console.error(error instanceof Error ? error.message : String(error));
}
