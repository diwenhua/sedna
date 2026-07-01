import type { GraphNode, Message, ResolvedAssistantReplyLocale } from "@sedna/protocol";

export interface LlmTextResult {
  content: string;
  provider: string;
  model?: string;
}

export interface LlmSelectedSkill {
  name: string;
  description: string;
  instructionMarkdown: string;
  requiredTools: string[];
}

export interface LlmSelectedTool {
  name: string;
  title: string;
  description: string;
  source: string;
}

export interface LlmConversationInput {
  ownerMessage: string;
  recentMessages: Message[];
  activeMemories: GraphNode[];
  replyLocale: ResolvedAssistantReplyLocale;
  agentToolsEnabled?: boolean;
  workerInventory?: string;
  workerContext?: string;
  selectedSkills?: LlmSelectedSkill[];
  selectedTools?: LlmSelectedTool[];
}

export interface LlmExtractionInput extends LlmConversationInput {
  assistantMessage: string;
}

export interface LlmProvider {
  name: string;
  generateAssistantReply(input: LlmConversationInput): Promise<LlmTextResult>;
  streamAssistantReply?(
    input: LlmConversationInput,
    onDelta: (delta: string) => void | Promise<void>
  ): Promise<LlmTextResult>;
  extractMemoryCandidates(input: LlmExtractionInput): Promise<unknown>;
}
