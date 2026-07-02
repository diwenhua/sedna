import { spawn } from "node:child_process";
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runWorkerAgentTask, type WorkerAgentLlmConfig } from "./agent-loop.js";

export interface FileSearchInput {
  query: string;
  paths: string[];
  max_results?: number;
}

export interface FileReadInput {
  path: string;
  max_bytes?: number;
}

export interface FileListInput {
  path: string;
  max_entries?: number;
}

export interface FileWriteInput {
  path: string;
  content: string;
  mode?: "overwrite" | "append";
  create_directories?: boolean;
}

export interface CommandRunInput {
  command: string;
  cwd?: string;
  timeout_ms?: number;
}

export interface WorkerRuntimePolicy {
  allowedPaths: string[];
  maxReadBytes: number;
  maxWriteBytes: number;
  maxSearchResults: number;
  maxListEntries: number;
  maxCommandMs: number;
  maxCommandOutputBytes: number;
}

export interface WorkerCapabilityContext {
  policy: WorkerRuntimePolicy;
  fetchAgentLlm?: () => Promise<WorkerAgentLlmConfig>;
  fetchImpl?: typeof fetch;
}

export async function executeWorkerCapability(
  capability: string,
  input: Record<string, unknown>,
  context: WorkerRuntimePolicy | WorkerCapabilityContext
): Promise<Record<string, unknown>> {
  const resolved = normalizeCapabilityContext(context);
  const policy = resolved.policy;
  if (capability === "worker.status") {
    return {
      ok: true,
      optional_path_roots: policy.allowedPaths,
      capabilities: ["worker.status", "agent.execute"]
    };
  }
  if (capability === "agent.execute") {
    const goal = typeof input.goal === "string" ? input.goal.trim() : "";
    if (goal.length === 0) {
      throw new Error("agent.execute requires goal.");
    }
    if (!resolved.fetchAgentLlm) {
      throw new Error("Worker agent LLM is not configured on Brain.");
    }
    const llm = await resolved.fetchAgentLlm();
    return runWorkerAgentTask({
      goal,
      context: typeof input.context === "string" ? input.context : undefined,
      policy,
      llm,
      fetchImpl: resolved.fetchImpl
    });
  }
  throw new Error(`Unsupported worker capability: ${capability}`);
}

function normalizeCapabilityContext(context: WorkerRuntimePolicy | WorkerCapabilityContext): WorkerCapabilityContext {
  if ("policy" in context) {
    return context;
  }
  return { policy: context };
}

export async function fileList(input: FileListInput, policy: WorkerRuntimePolicy): Promise<Record<string, unknown>> {
  const maxEntries = Math.min(input.max_entries ?? policy.maxListEntries, policy.maxListEntries);
  assertPathAllowed(input.path, policy.allowedPaths);
  const directoryStat = await stat(input.path);
  if (!directoryStat.isDirectory()) {
    throw new Error("file.list only supports directories.");
  }
  const entries: Array<{ path: string; name: string; type: "file" | "directory"; size: number; modified_at: string }> = [];
  for (const entry of await readdir(input.path, { withFileTypes: true })) {
    if (entries.length >= maxEntries) {
      break;
    }
    if (!entry.isFile() && !entry.isDirectory()) {
      continue;
    }
    const entryPath = path.join(input.path, entry.name);
    if (isForbiddenPath(entryPath)) {
      continue;
    }
    const entryStat = await stat(entryPath);
    entries.push({
      path: entryPath,
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
      size: Number(entryStat.size),
      modified_at: entryStat.mtime.toISOString()
    });
  }
  return {
    path: input.path,
    entries,
    truncated: entries.length >= maxEntries
  };
}

export async function fileSearch(input: FileSearchInput, policy: WorkerRuntimePolicy): Promise<Record<string, unknown>> {
  const query = input.query.trim().toLowerCase();
  if (query.length === 0) {
    throw new Error("file.search query is required.");
  }
  const maxResults = Math.min(input.max_results ?? policy.maxSearchResults, policy.maxSearchResults);
  const matches: Array<{ path: string; name: string; size: number; modified_at: string }> = [];
  for (const searchPath of resolveSearchPaths(input.paths, policy.allowedPaths)) {
    assertPathAllowed(searchPath, policy.allowedPaths);
    await walk(searchPath, async (entryPath, entryStat) => {
      if (matches.length >= maxResults) {
        return false;
      }
      const name = path.basename(entryPath);
      if (name.toLowerCase().includes(query)) {
        matches.push({
          path: entryPath,
          name,
          size: Number(entryStat.size),
          modified_at: entryStat.mtime.toISOString()
        });
      }
      return true;
    });
    if (matches.length >= maxResults) {
      break;
    }
  }
  return { matches };
}

export async function fileRead(input: FileReadInput, policy: WorkerRuntimePolicy): Promise<Record<string, unknown>> {
  const maxBytes = Math.min(input.max_bytes ?? policy.maxReadBytes, policy.maxReadBytes);
  assertPathAllowed(input.path, policy.allowedPaths);
  const fileStat = await stat(input.path);
  if (!fileStat.isFile()) {
    throw new Error("file.read only supports regular files.");
  }
  const buffer = await readFile(input.path);
  const sliced = buffer.subarray(0, maxBytes);
  return {
    path: input.path,
    content: sliced.toString("utf8"),
    truncated: buffer.length > maxBytes,
    size: buffer.length
  };
}

export async function fileWrite(input: FileWriteInput, policy: WorkerRuntimePolicy): Promise<Record<string, unknown>> {
  const targetPath = path.resolve(input.path);
  assertPathAllowed(targetPath, policy.allowedPaths);
  const content = input.content;
  const byteLength = Buffer.byteLength(content, "utf8");
  if (byteLength > policy.maxWriteBytes) {
    throw new Error("Write content exceeds worker max write size.");
  }
  if (input.create_directories) {
    await mkdir(path.dirname(targetPath), { recursive: true });
  }
  if (input.mode === "append") {
    await appendFile(targetPath, content, "utf8");
  } else {
    await writeFile(targetPath, content, "utf8");
  }
  return {
    path: targetPath,
    bytes_written: byteLength,
    mode: input.mode ?? "overwrite"
  };
}

export async function commandRun(input: CommandRunInput, policy: WorkerRuntimePolicy): Promise<Record<string, unknown>> {
  const command = input.command.trim();
  if (command.length === 0) {
    throw new Error("command_run requires command.");
  }
  const cwd = path.resolve(input.cwd ?? process.cwd());
  assertPathAllowed(cwd, policy.allowedPaths);
  const timeoutMs = Math.min(input.timeout_ms ?? policy.maxCommandMs, policy.maxCommandMs);
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    const appendOutput = (current: string, chunk: Buffer, stream: "stdout" | "stderr") => {
      const next = current + chunk.toString("utf8");
      if (Buffer.byteLength(next, "utf8") <= policy.maxCommandOutputBytes) {
        return next;
      }
      const truncated = Buffer.from(next, "utf8").subarray(0, policy.maxCommandOutputBytes).toString("utf8");
      if (stream === "stdout") {
        stderr += "\n[stdout truncated by worker policy]\n";
      } else {
        stderr += "\n[stderr truncated by worker policy]\n";
      }
      return truncated;
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk, "stdout");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk, "stderr");
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({
        command,
        cwd,
        exit_code: exitCode,
        signal,
        timed_out: timedOut,
        duration_ms: Date.now() - startedAt,
        stdout,
        stderr
      });
    });
  });
}

export function assertPathAllowed(targetPath: string, allowedPaths: string[]): void {
  if (isForbiddenPath(targetPath)) {
    throw new Error("Path is forbidden by worker policy.");
  }
  if (allowedPaths.length === 0) {
    return;
  }
  const normalizedTarget = normalizePath(targetPath);
  if (!allowedPaths.some((allowedPath) => {
    const normalizedAllowed = normalizePath(allowedPath);
    return normalizedTarget === normalizedAllowed || normalizedTarget.startsWith(`${normalizedAllowed}${path.sep}`);
  })) {
    throw new Error("Path is outside worker allowlist.");
  }
}

function resolveSearchPaths(inputPaths: string[], allowedPaths: string[]): string[] {
  if (inputPaths.length > 0) {
    return inputPaths;
  }
  if (allowedPaths.length > 0) {
    return allowedPaths;
  }
  return [os.homedir()];
}

export function parseAllowedPaths(value: string | undefined): string[] {
  return (value ?? "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
}

function parseFileSearchInput(input: Record<string, unknown>): FileSearchInput {
  return {
    query: typeof input.query === "string" ? input.query : "",
    paths: Array.isArray(input.paths) ? input.paths.map((item) => path.resolve(String(item))) : [],
    max_results: typeof input.max_results === "number" ? input.max_results : undefined
  };
}

function parseFileReadInput(input: Record<string, unknown>): FileReadInput {
  return {
    path: path.resolve(String(input.path ?? "")),
    max_bytes: typeof input.max_bytes === "number" ? input.max_bytes : undefined
  };
}

function parseFileListInput(input: Record<string, unknown>): FileListInput {
  return {
    path: path.resolve(String(input.path ?? "")),
    max_entries: typeof input.max_entries === "number" ? input.max_entries : undefined
  };
}

async function walk(
  directory: string,
  onFile: (entryPath: string, entryStat: Awaited<ReturnType<typeof stat>>) => Promise<boolean> | boolean
): Promise<boolean> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (isForbiddenPath(entryPath)) {
      continue;
    }
    if (entry.isDirectory()) {
      const shouldContinue = await walk(entryPath, onFile);
      if (!shouldContinue) {
        return false;
      }
      continue;
    }
    if (entry.isFile()) {
      const entryStat = await stat(entryPath);
      const shouldContinue = await onFile(entryPath, entryStat);
      if (!shouldContinue) {
        return false;
      }
    }
  }
  return true;
}

function isForbiddenPath(targetPath: string): boolean {
  const normalized = targetPath.toLowerCase().replace(/\\/g, "/");
  const baseName = path.basename(normalized);
  return /(^|\/)(\.env|\.ssh)(\/|$)/.test(normalized)
    || baseName === ".env"
    || baseName.startsWith(".env.")
    || /\.(sqlite|sqlite3|db|pem|key|p12|pfx)$/i.test(normalized)
    || normalized.includes("credential")
    || normalized.includes("secret");
}

function normalizePath(value: string): string {
  return path.resolve(value);
}
