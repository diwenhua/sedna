import type { GraphNode, Message } from "@sedna/protocol";

export function buildExtractMemoryPrompt(input: {
  ownerMessage: string;
  assistantMessage: string;
  recentMessages: Message[];
  activeMemories: GraphNode[];
}): string {
  const activeMemoryText = input.activeMemories.map((memory) => `${memory.type}: ${memory.label}`).join("\n") || "None";
  const recentText = input.recentMessages.slice(-6).map((message) => `${message.role}: ${message.content}`).join("\n");
  return `Extract candidate memories from the latest owner/assistant interaction.
Do not mark anything active. Return only candidate memory proposals.
Prefer concrete goals, projects, preferences, constraints, success criteria, resources, methods, tasks, or suggested actions.
Use the owner's exact words as evidence_quote when possible.

Active memories:
${activeMemoryText}

Recent messages:
${recentText}

Latest owner message:
${input.ownerMessage}

Assistant reply:
${input.assistantMessage}`;
}
