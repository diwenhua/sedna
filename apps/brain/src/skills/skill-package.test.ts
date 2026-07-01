import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import { createMemoryStore } from "@sedna/memory";
import {
  findSkillMarkdownFiles,
  importSkillsFromZip,
  parseSkillMarkdown
} from "./skill-package.js";

describe("skill-package", () => {
  it("parses standard SKILL.md frontmatter", () => {
    const parsed = parseSkillMarkdown(`---
name: demo-skill
description: Demo skill for tests
required_tools: task.create, memory.search
risk_level: medium
---
# Demo

Follow these steps.`);

    expect(parsed).toEqual({
      name: "demo-skill",
      description: "Demo skill for tests",
      instructionMarkdown: "# Demo\n\nFollow these steps.",
      requiredTools: ["task.create", "memory.search"],
      riskLevel: "medium"
    });
  });

  it("imports skills from a zip package", async () => {
    const dbDir = await mkdtemp(join(tmpdir(), "sedna-skill-db-"));
    const skillsDir = await mkdtemp(join(tmpdir(), "sedna-skill-dir-"));
    const store = createMemoryStore(join(dbDir, "test.sqlite"));
    store.migrate();

    const zip = new AdmZip();
    zip.addFile(
      "demo-skill/SKILL.md",
      Buffer.from(`---
name: demo-skill
description: Imported from zip
---
# Demo Skill

Use this workflow.`)
    );
    zip.addFile("demo-skill/scripts/run.sh", Buffer.from("#!/bin/sh\necho ok"));

    const imported = await importSkillsFromZip(store, zip.toBuffer(), { skillsDir });
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      name: "demo-skill",
      description: "Imported from zip",
      sourceType: "imported",
      enabled: true
    });
    expect(await readFile(join(skillsDir, "demo-skill", "scripts", "run.sh"), "utf8")).toContain("echo ok");

    await store.close();
    await rm(dbDir, { recursive: true, force: true });
    await rm(skillsDir, { recursive: true, force: true });
  });

  it("finds nested SKILL.md files", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "sedna-skill-find-"));
    const nestedDir = join(tempRoot, "nested");
    await mkdir(nestedDir, { recursive: true });
    await writeFile(
      join(nestedDir, "SKILL.md"),
      `---
name: nested
description: nested skill
---
# Nested`
    );

    const found = await findSkillMarkdownFiles(tempRoot);
    expect(found).toHaveLength(1);

    await rm(tempRoot, { recursive: true, force: true });
  });
});
