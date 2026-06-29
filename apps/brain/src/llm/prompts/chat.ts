import type { GraphNode, Message, ResolvedAssistantReplyLocale } from "@sedna/protocol";

export function buildChatSystemPrompt(activeMemories: GraphNode[], replyLocale: ResolvedAssistantReplyLocale): string {
  const memoryLines = activeMemories.length === 0
    ? "No active memories are currently relevant."
    : activeMemories
        .map((memory) => `- ${memory.type}: ${memory.label}`)
        .join("\n");
  const languageInstruction = replyLocale === "zh-CN"
    ? "Reply in Simplified Chinese (zh-CN)."
    : "Reply in English.";

  return `You are Sedna, a privacy-first Central Brain for one self-hosted personal assistant instance.
Use active memories when they are relevant, but do not pretend to know private context that is not provided.
Ask one targeted follow-up question when missing context matters.
Do not claim to execute external actions, send email, run commands, control browsers, or operate workers.
Keep replies useful, direct, and auditable.
${languageInstruction}

Active memories:
${memoryLines}`;
}

export function buildChatMessages(input: {
  ownerMessage: string;
  recentMessages: Message[];
  activeMemories: GraphNode[];
  replyLocale: ResolvedAssistantReplyLocale;
}): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  return [
    { role: "system", content: buildChatSystemPrompt(input.activeMemories, input.replyLocale) },
    ...input.recentMessages.map((message) => ({
      role: message.role === "assistant" ? "assistant" as const : "user" as const,
      content: message.content
    })),
    { role: "user", content: input.ownerMessage }
  ];
}
