import AdmZip from "adm-zip";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { MemoryStore } from "@sedna/memory";
import type { RiskLevel, SkillDefinition } from "@sedna/protocol";

export function resolveSkillsDir(override?: string): string {
  return override ?? process.env.SEDNA_SKILLS_DIR ?? join(process.cwd(), "data/skills");
}

export function parseSkillMarkdown(content: string): {
  name: string;
  description: string;
  instructionMarkdown: string;
  requiredTools: string[];
  riskLevel: RiskLevel;
} {
  const { frontmatter, body } = parseFrontmatter(content);
  const name = frontmatter.name?.trim();
  if (!name) {
    throw new Error("SKILL.md frontmatter must include name");
  }
  return {
    name,
    description: frontmatter.description?.trim() ?? "",
    instructionMarkdown: body.trim(),
    requiredTools: parseRequiredTools(frontmatter.required_tools),
    riskLevel: parseRiskLevel(frontmatter.risk_level)
  };
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error("SKILL.md must start with YAML frontmatter");
  }
  return { frontmatter: parseSimpleYaml(match[1]), body: match[2] };
}

function parseSimpleYaml(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) {
      index += 1;
      continue;
    }
    const key = keyMatch[1];
    const rawValue = keyMatch[2];
    if (rawValue === "|" || rawValue === ">" || rawValue === ">-" || rawValue === "|-") {
      const blockLines: string[] = [];
      index += 1;
      while (index < lines.length) {
        const nextLine = lines[index];
        if (/^[a-zA-Z0-9_-]+:\s*/.test(nextLine)) {
          break;
        }
        blockLines.push(nextLine.replace(/^  /, ""));
        index += 1;
      }
      result[key] = blockLines.join("\n").trim();
      continue;
    }
    result[key] = rawValue.trim().replace(/^['"]|['"]$/g, "");
    index += 1;
  }
  return result;
}

function parseRequiredTools(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseRiskLevel(value: string | undefined): RiskLevel {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return "low";
}

export async function findSkillMarkdownFiles(rootDir: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__MACOSX" || entry.name.startsWith(".")) {
          continue;
        }
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
        found.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return found.sort();
}

export async function extractZipToDirectory(zipBuffer: Buffer, targetDir: string): Promise<void> {
  const zip = new AdmZip(zipBuffer);
  const root = resolve(targetDir);
  await mkdir(root, { recursive: true });

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) {
      continue;
    }
    const entryName = entry.entryName.replace(/\\/g, "/");
    if (!entryName || entryName.includes("..") || entryName.startsWith("/")) {
      throw new Error(`Unsafe zip entry: ${entry.entryName}`);
    }
    const destPath = resolve(root, entryName);
    if (destPath !== root && !destPath.startsWith(`${root}${sep}`)) {
      throw new Error(`Unsafe zip entry path: ${entry.entryName}`);
    }
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, entry.getData());
  }
}

function slugifySkillDir(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "skill";
}

export async function importSkillsFromZip(
  store: MemoryStore,
  zipBuffer: Buffer,
  options: { skillsDir?: string } = {}
): Promise<SkillDefinition[]> {
  const skillsDir = resolveSkillsDir(options.skillsDir);
  await mkdir(skillsDir, { recursive: true });

  const tempRoot = join(tmpdir(), `sedna-skill-import-${randomUUID()}`);
  await mkdir(tempRoot, { recursive: true });

  try {
    await extractZipToDirectory(zipBuffer, tempRoot);
    const skillFiles = await findSkillMarkdownFiles(tempRoot);
    if (skillFiles.length === 0) {
      throw new Error("No SKILL.md found in zip. Expected standard skill folder structure.");
    }

    const imported: SkillDefinition[] = [];
    for (const skillMarkdownPath of skillFiles) {
      const content = await readFile(skillMarkdownPath, "utf8");
      const parsed = parseSkillMarkdown(content);
      const sourceSkillDir = dirname(skillMarkdownPath);
      const destDir = join(skillsDir, slugifySkillDir(parsed.name));

      const existing = store.getSkillByName(parsed.name);
      if (existing?.storagePath) {
        await rm(existing.storagePath, { recursive: true, force: true });
      }
      await rm(destDir, { recursive: true, force: true });
      await cp(sourceSkillDir, destDir, { recursive: true });

      imported.push(store.upsertImportedSkill({
        name: parsed.name,
        description: parsed.description,
        instructionMarkdown: parsed.instructionMarkdown,
        requiredTools: parsed.requiredTools,
        riskLevel: parsed.riskLevel,
        storagePath: destDir
      }));
    }
    return imported;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function removeSkillStorage(storagePath: string, skillsDir?: string): Promise<void> {
  if (!storagePath.trim()) {
    return;
  }
  const resolved = resolve(storagePath);
  const skillsRoot = resolve(resolveSkillsDir(skillsDir));
  if (resolved !== skillsRoot && !resolved.startsWith(`${skillsRoot}${sep}`)) {
    throw new Error("Refusing to delete skill storage outside skills directory.");
  }
  await rm(resolved, { recursive: true, force: true });
}
