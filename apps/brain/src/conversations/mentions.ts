import type { MemoryStore } from "@sedna/memory";
import type { SkillDefinition, ToolRegistryEntry } from "@sedna/protocol";

const MENTION_PATTERN = /@(skill|tool):([a-zA-Z0-9._-]+)/g;

export interface ParsedMention {
  kind: "skill" | "tool";
  name: string;
}

export interface ResolvedMentions {
  skills: SkillDefinition[];
  tools: ToolRegistryEntry[];
}

export function parseMessageMentions(content: string): ParsedMention[] {
  const seen = new Set<string>();
  const mentions: ParsedMention[] = [];
  for (const match of content.matchAll(MENTION_PATTERN)) {
    const kind = match[1] as ParsedMention["kind"];
    const name = match[2];
    const key = `${kind}:${name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    mentions.push({ kind, name });
  }
  return mentions;
}

export function resolveMessageMentions(store: MemoryStore, content: string): ResolvedMentions {
  const parsed = parseMessageMentions(content);
  const skills: SkillDefinition[] = [];
  const tools: ToolRegistryEntry[] = [];

  for (const mention of parsed) {
    if (mention.kind === "skill") {
      const skill = store.listSkills().find((item) => item.enabled && item.name === mention.name);
      if (skill) {
        skills.push(skill);
      }
      continue;
    }
    const tool = store.listToolRegistryEntries().find((item) => item.enabled && item.name === mention.name);
    if (tool) {
      tools.push(tool);
    }
  }

  return { skills, tools };
}

export function buildSelectedSkillsContext(skills: SkillDefinition[]): string | undefined {
  if (skills.length === 0) {
    return undefined;
  }
  const blocks = skills.map((skill) => {
    const requiredTools = skill.requiredTools.length > 0 ? skill.requiredTools.join(", ") : "none";
    return [
      `### @skill:${skill.name}`,
      `Description: ${skill.description || "(none)"}`,
      `Required tools: ${requiredTools}`,
      "Instructions:",
      skill.instructionMarkdown || "(empty)"
    ].join("\n");
  });
  return blocks.join("\n\n");
}

export function buildSelectedToolsContext(tools: ToolRegistryEntry[]): string | undefined {
  if (tools.length === 0) {
    return undefined;
  }
  const lines = tools.map((tool) =>
    `- @tool:${tool.name} (${tool.title}, ${tool.source}): ${tool.description || "(no description)"}`
  );
  return lines.join("\n");
}
