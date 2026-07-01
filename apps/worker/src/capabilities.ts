import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

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

export interface WorkerRuntimePolicy {
  allowedPaths: string[];
  maxReadBytes: number;
  maxSearchResults: number;
  maxListEntries: number;
}

const SKIPPED_DIRS = new Set([".git", "node_modules", "dist", "build"]);

export async function executeWorkerCapability(
  capability: string,
  input: Record<string, unknown>,
  policy: WorkerRuntimePolicy
): Promise<Record<string, unknown>> {
  if (capability === "worker.status") {
    return {
      ok: true,
      allowed_paths: policy.allowedPaths,
      capabilities: ["worker.status", "file.search", "file.read", "file.list"]
    };
  }
  if (capability === "file.list") {
    return fileList(parseFileListInput(input), policy);
  }
  if (capability === "file.search") {
    return fileSearch(parseFileSearchInput(input), policy);
  }
  if (capability === "file.read") {
    return fileRead(parseFileReadInput(input), policy);
  }
  throw new Error(`Unsupported worker capability: ${capability}`);
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
    if (SKIPPED_DIRS.has(entry.name)) {
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
  for (const searchPath of input.paths) {
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

export function assertPathAllowed(targetPath: string, allowedPaths: string[]): void {
  if (isForbiddenPath(targetPath)) {
    throw new Error("Path is forbidden by worker policy.");
  }
  const normalizedTarget = normalizePath(targetPath);
  if (!allowedPaths.some((allowedPath) => {
    const normalizedAllowed = normalizePath(allowedPath);
    return normalizedTarget === normalizedAllowed || normalizedTarget.startsWith(`${normalizedAllowed}${path.sep}`);
  })) {
    throw new Error("Path is outside worker allowlist.");
  }
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
      if (SKIPPED_DIRS.has(entry.name)) {
        continue;
      }
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
  return /(^|\/)(\.env|\.ssh|node_modules|dist|build|\.git)(\/|$)/.test(normalized)
    || /\.(sqlite|sqlite3|db|pem|key|p12|pfx)$/i.test(normalized)
    || normalized.includes("credential")
    || normalized.includes("secret");
}

function normalizePath(value: string): string {
  return path.resolve(value);
}
