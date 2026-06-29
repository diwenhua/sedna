import type { GraphNode, Message, ResolvedAssistantReplyLocale } from "@sedna/protocol";

export interface LlmTextResult {
  content: string;
  provider: string;
  model?: string;
}

export interface LlmConversationInput {
  ownerMessage: string;
  recentMessages: Message[];
  activeMemories: GraphNode[];
  replyLocale: ResolvedAssistantReplyLocale;
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
