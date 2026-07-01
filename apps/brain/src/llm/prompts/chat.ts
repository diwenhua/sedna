import type { GraphNode, Message, ResolvedAssistantReplyLocale } from "@sedna/protocol";

export function buildChatSystemPrompt(
  activeMemories: GraphNode[],
  replyLocale: ResolvedAssistantReplyLocale,
  agentToolsEnabled = false,
  workerInventory?: string,
  workerContext?: string,
  selectedSkillsContext?: string,
  selectedToolsContext?: string
): string {
  const memorySection = agentToolsEnabled
    ? "Private owner context is not preloaded. Use owner_profile_read and memory_search when you need personalization or stored facts."
    : activeMemories.length === 0
      ? "No active memories are currently relevant."
      : activeMemories
          .map((memory) => `- ${memory.type}: ${memory.label}`)
          .join("\n");
  const languageInstruction = replyLocale === "zh-CN"
    ? "Reply in Simplified Chinese (zh-CN)."
    : "Reply in English.";

  const agentToolInstruction = agentToolsEnabled
    ? `You operate in agent mode. Decide which tools to call based on the owner's message.
Available tools:
- owner_profile_read: active owner profile attributes (home city, gender, preferences, identity, habits)
- memory_search: search stored active memories when recent chat is not enough
- web_search / web_fetch: live public information such as weather, news, prices, and schedules (when configured)
Call owner_profile_read or memory_search before guessing private owner context.
Use web_search when the answer depends on current public information.
Do not say you cannot access the internet when web_search is available.
Workers are separate from these tools. Local file.list, file.search, and file.read may appear in worker observation context below.
Answer worker availability and online/offline questions from the registered workers list below.
Active memories about worker capabilities are not your callable tool list.`
    : `Agent tools are unavailable in this reply path because the configured chat provider does not support tool calling.
Answer from recent conversation only. Do not guess private owner context that was not stated in the chat.
Do not claim to execute external actions, send email, run commands, control browsers, or browse the public web.
Answer worker availability and online/offline questions from the registered workers list below when it is provided.
Local read-only file actions may appear as worker observation context when an online worker completes a job.`;

  const workerInventoryBlock = workerInventory
    ? `\n\nRegistered workers:\n${workerInventory}`
    : "\n\nRegistered workers:\nNo workers are registered.";
  const workerContextBlock = workerContext
    ? `\n\nWorker observation context:\n${workerContext}`
    : "";
  const selectedSkillsBlock = selectedSkillsContext
    ? `\n\nSelected skills (the owner @-mentioned these; follow their workflows for this reply):\n${selectedSkillsContext}`
    : "";
  const selectedToolsBlock = selectedToolsContext
    ? `\n\nSelected tools (the owner @-mentioned these registered tools for this message):\n${selectedToolsContext}`
    : "";

  return `You are Sedna, a privacy-first Central Brain for one self-hosted personal assistant instance.
Ask one targeted follow-up question when missing context matters.
${agentToolInstruction}
When worker observation context is provided, use it as the result of an approved read-only local worker action already executed by Brain. Do not claim more local access than the observation shows, and do not say you need a separate file.list tool when the observation already contains directory or file results.
The registered workers list is Brain's current registry view from heartbeats and owner policy. Use it directly to answer whether a worker is online or offline.
If the owner asks which workers exist or whether a worker is available, answer from the registered workers list and worker observation context. Mention status, last heartbeat, enabled capabilities, and allowed paths when relevant.
If a worker is offline, say so clearly from the registry snapshot and explain that local file actions require an online worker process with recent heartbeat.
Never tell the owner to manually call Brain API endpoints to check worker status.
Keep replies useful, direct, and auditable.
${languageInstruction}

${agentToolsEnabled ? "Memory context:" : "Active memories:"}
${memorySection}${workerInventoryBlock}${workerContextBlock}${selectedSkillsBlock}${selectedToolsBlock}`;
}

export function buildChatMessages(input: {
  ownerMessage: string;
  recentMessages: Message[];
  activeMemories: GraphNode[];
  replyLocale: ResolvedAssistantReplyLocale;
  agentToolsEnabled?: boolean;
  workerInventory?: string;
  workerContext?: string;
  selectedSkills?: Array<{
    name: string;
    description: string;
    instructionMarkdown: string;
    requiredTools: string[];
  }>;
  selectedTools?: Array<{
    name: string;
    title: string;
    description: string;
    source: string;
  }>;
}): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const selectedSkillsContext = input.selectedSkills?.length
    ? input.selectedSkills.map((skill) => {
        const requiredTools = skill.requiredTools.length > 0 ? skill.requiredTools.join(", ") : "none";
        return [
          `### @skill:${skill.name}`,
          `Description: ${skill.description || "(none)"}`,
          `Required tools: ${requiredTools}`,
          "Instructions:",
          skill.instructionMarkdown || "(empty)"
        ].join("\n");
      }).join("\n\n")
    : undefined;
  const selectedToolsContext = input.selectedTools?.length
    ? input.selectedTools.map((tool) =>
        `- @tool:${tool.name} (${tool.title}, ${tool.source}): ${tool.description || "(no description)"}`
      ).join("\n")
    : undefined;

  return [
    {
      role: "system",
      content: buildChatSystemPrompt(
        input.activeMemories,
        input.replyLocale,
        input.agentToolsEnabled,
        input.workerInventory,
        input.workerContext,
        selectedSkillsContext,
        selectedToolsContext
      )
    },
    ...input.recentMessages.map((message) => ({
      role: message.role === "assistant" ? "assistant" as const : "user" as const,
      content: message.content
    })),
    { role: "user", content: input.ownerMessage }
  ];
}
