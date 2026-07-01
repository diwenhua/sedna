import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileList, fileRead, fileSearch } from "./capabilities.js";

describe("worker file capabilities", () => {
  it("lists directory entries inside allowed paths without reading content or skipped directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `sedna-worker-test-${randomUUID()}-`));
    await writeFile(path.join(root, "README.md"), "private content", "utf8");
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "index.ts"), "source", "utf8");
    await mkdir(path.join(root, "node_modules"));
    await writeFile(path.join(root, "node_modules", "hidden.js"), "hidden", "utf8");

    const result = await fileList({ path: root, max_entries: 10 }, {
      allowedPaths: [root],
      maxReadBytes: 200000,
      maxSearchResults: 50,
      maxListEntries: 50
    });

    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "README.md", type: "file" }),
      expect.objectContaining({ name: "src", type: "directory" })
    ]));
    expect(JSON.stringify(result)).not.toContain("private content");
    expect(JSON.stringify(result)).not.toContain("hidden.js");
  });

  it("searches only inside allowed paths without reading content", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `sedna-worker-test-${randomUUID()}-`));
    await writeFile(path.join(root, "notes-about-sedna.md"), "private content", "utf8");

    const result = await fileSearch({ query: "sedna", paths: [root], max_results: 10 }, {
      allowedPaths: [root],
      maxReadBytes: 200000,
      maxSearchResults: 50,
      maxListEntries: 50
    });

    expect(result.matches).toEqual([
      expect.objectContaining({ name: "notes-about-sedna.md" })
    ]);
    expect(JSON.stringify(result)).not.toContain("private content");
  });

  it("rejects reads outside the allowlist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `sedna-worker-test-${randomUUID()}-`));
    const outside = path.join(os.tmpdir(), `sedna-outside-${randomUUID()}.txt`);
    await writeFile(outside, "outside", "utf8");

    await expect(fileRead({ path: outside }, {
      allowedPaths: [root],
      maxReadBytes: 200000,
      maxSearchResults: 50,
      maxListEntries: 50
    })).rejects.toThrow("allowlist");
  });

  it("rejects forbidden sensitive paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `sedna-worker-test-${randomUUID()}-`));
    const envPath = path.join(root, ".env");
    await writeFile(envPath, "OPENAI_API_KEY=secret", "utf8");

    await expect(fileRead({ path: envPath }, {
      allowedPaths: [root],
      maxReadBytes: 200000,
      maxSearchResults: 50,
      maxListEntries: 50
    })).rejects.toThrow("forbidden");
  });
});
