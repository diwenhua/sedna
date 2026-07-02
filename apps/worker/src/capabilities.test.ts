import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commandRun, fileList, fileRead, fileSearch, fileWrite } from "./capabilities.js";

const basePolicy = {
  allowedPaths: [] as string[],
  maxReadBytes: 200000,
  maxWriteBytes: 500000,
  maxSearchResults: 50,
  maxListEntries: 50,
  maxCommandMs: 5000,
  maxCommandOutputBytes: 200000
};

describe("worker file capabilities", () => {
  it("lists directory entries without reading file content", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `sedna-worker-test-${randomUUID()}-`));
    await writeFile(path.join(root, "README.md"), "private content", "utf8");
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "index.ts"), "source", "utf8");
    await mkdir(path.join(root, "node_modules"));
    await writeFile(path.join(root, "node_modules", "hidden.js"), "hidden", "utf8");

    const result = await fileList({ path: root, max_entries: 10 }, {
      ...basePolicy,
      allowedPaths: [root]
    });

    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "README.md", type: "file" }),
      expect.objectContaining({ name: "src", type: "directory" }),
      expect.objectContaining({ name: "node_modules", type: "directory" })
    ]));
    expect(JSON.stringify(result)).not.toContain("private content");
    expect(JSON.stringify(result)).not.toContain("hidden.js");
  });

  it("searches inside allowed paths without reading content", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `sedna-worker-test-${randomUUID()}-`));
    await writeFile(path.join(root, "notes-about-sedna.md"), "private content", "utf8");

    const result = await fileSearch({ query: "sedna", paths: [root], max_results: 10 }, {
      ...basePolicy,
      allowedPaths: [root]
    });

    expect(result.matches).toEqual([
      expect.objectContaining({ name: "notes-about-sedna.md" })
    ]);
    expect(JSON.stringify(result)).not.toContain("private content");
  });

  it("writes and reads files inside optional allowlist roots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `sedna-worker-test-${randomUUID()}-`));
    const target = path.join(root, "output.txt");

    await fileWrite({
      path: target,
      content: "hello sedna"
    }, {
      ...basePolicy,
      allowedPaths: [root]
    });

    const result = await fileRead({ path: target }, {
      ...basePolicy,
      allowedPaths: [root]
    });
    expect(result.content).toBe("hello sedna");
  });

  it("runs shell commands in an allowed working directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `sedna-worker-test-${randomUUID()}-`));

    const result = await commandRun({
      command: process.platform === "win32" ? "echo sedna-worker" : "printf sedna-worker",
      cwd: root
    }, {
      ...basePolicy,
      allowedPaths: [root]
    });

    expect(result.exit_code).toBe(0);
    expect(String(result.stdout)).toContain("sedna-worker");
  });

  it("rejects reads outside the allowlist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `sedna-worker-test-${randomUUID()}-`));
    const outside = path.join(os.tmpdir(), `sedna-outside-${randomUUID()}.txt`);
    await writeFile(outside, "outside", "utf8");

    await expect(fileRead({ path: outside }, {
      ...basePolicy,
      allowedPaths: [root]
    })).rejects.toThrow("allowlist");
  });

  it("rejects forbidden sensitive paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `sedna-worker-test-${randomUUID()}-`));
    const envPath = path.join(root, ".env");
    await writeFile(envPath, "OPENAI_API_KEY=secret", "utf8");

    await expect(fileRead({ path: envPath }, {
      ...basePolicy,
      allowedPaths: [root]
    })).rejects.toThrow("forbidden");
  });
});
