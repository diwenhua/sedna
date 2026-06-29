import type { ExtractedMemory, MemoryStore } from "@sedna/memory";
import type { MemoryCandidate, Message, ResolvedAssistantReplyLocale, Settings } from "@sedna/protocol";
import { ExtractionResultSchema, type ExtractedMemoryCandidate } from "../llm/schemas.js";
import type { LlmProvider } from "../llm/provider.js";

export interface ConversationMessageFlowInput {
  store: MemoryStore;
  provider: LlmProvider;
  conversationId: string;
  content: string;
  onProgress?: (event: ConversationMessageFlowEvent) => void | Promise<void>;
}

export interface ConversationMessageFlowResult {
  ownerMessage: Message;
  assistantMessage: Message;
  candidates: MemoryCandidate[];
}

export type ConversationMessageFlowEvent =
  | { type: "owner_message"; message: Message }
  | { type: "assistant_status"; phase: "thinking" | "reply_ready" | "memory_extraction" | "done"; title: string }
  | { type: "assistant_delta"; content: string }
  | { type: "assistant_message"; message: Message }
  | { type: "memory_candidates"; candidates: MemoryCandidate[] }
  | { type: "error"; message: string };

export async function runConversationMessageFlow(
  input: ConversationMessageFlowInput
): Promise<ConversationMessageFlowResult> {
  const settings = input.store.getSettings();
  const replyLocale = resolveAssistantReplyLocale(settings);
  const ownerMessage = input.store.createMessage(input.conversationId, "owner", input.content, {
    locale: settings.uiLocale
  });
  input.store.recordMessageCreatedEvent(ownerMessage, "Owner message created");
  input.store.recordAuditRecord("owner", "message.create", "message", ownerMessage.id, {
    conversationId: input.conversationId
  });
  await input.onProgress?.({ type: "owner_message", message: ownerMessage });
  await input.onProgress?.({ type: "assistant_status", phase: "thinking", title: "Thinking" });

  const recentMessages = input.store
    .listRecentMessages(input.conversationId, 12)
    .filter((message) => message.id !== ownerMessage.id);
  const activeMemories = input.store.listActiveMemoryNodes(input.content, 12);

  let assistantContent: string;
  let assistantMetadata: Record<string, unknown>;
  try {
    const replyInput = {
      ownerMessage: input.content,
      recentMessages,
      activeMemories,
      replyLocale
    };
    const reply = input.provider.streamAssistantReply
      ? await input.provider.streamAssistantReply(replyInput, async (delta) => {
          await input.onProgress?.({ type: "assistant_delta", content: delta });
        })
      : await input.provider.generateAssistantReply(replyInput);
    assistantContent = reply.content;
    assistantMetadata = {
      generatedFrom: ownerMessage.id,
      provider: reply.provider,
      model: reply.model,
      locale: replyLocale
    };
    await input.onProgress?.({ type: "assistant_status", phase: "reply_ready", title: "Reply ready" });
  } catch (error) {
    const normalizedError = normalizeError(error);
    input.store.recordLlmError(input.conversationId, ownerMessage.id, normalizedError, input.provider.name);
    assistantContent = `I could not generate a reply because the configured LLM provider failed: ${normalizedError.message}`;
    assistantMetadata = {
      generatedFrom: ownerMessage.id,
      provider: input.provider.name,
      error: normalizedError.message
    };
    await input.onProgress?.({ type: "error", message: normalizedError.message });
  }

  const assistantMessage = input.store.createMessage(
    input.conversationId,
    "assistant",
    assistantContent,
    assistantMetadata
  );
  input.store.recordMessageCreatedEvent(assistantMessage, "Assistant message created");
  await input.onProgress?.({ type: "assistant_message", message: assistantMessage });

  const candidates: MemoryCandidate[] = [];
  if (!("error" in assistantMetadata)) {
    try {
      await input.onProgress?.({ type: "assistant_status", phase: "memory_extraction", title: "Extracting memory candidates" });
      const rawExtraction = await input.provider.extractMemoryCandidates({
        ownerMessage: input.content,
        assistantMessage: assistantContent,
      recentMessages: input.store.listRecentMessages(input.conversationId, 12),
      activeMemories,
      replyLocale
      });
      const parsed = ExtractionResultSchema.parse(rawExtraction);
      for (const candidate of parsed.candidates) {
        candidates.push(input.store.createMemoryCandidate(toExtractedMemory(candidate, ownerMessage.locale), ownerMessage));
      }
      await input.onProgress?.({ type: "memory_candidates", candidates });
    } catch (error) {
      input.store.recordMemoryExtractionFailure(
        input.conversationId,
        assistantMessage.id,
        normalizeError(error),
        input.provider.name
      );
    }
  }
  await input.onProgress?.({ type: "assistant_status", phase: "done", title: "Done" });

  return {
    ownerMessage,
    assistantMessage,
    candidates
  };
}

function toExtractedMemory(candidate: ExtractedMemoryCandidate, locale: string | undefined): ExtractedMemory {
  return {
    kind: candidate.type,
    label: candidate.label,
    proposedNodeType: candidate.type === "success_criterion" ? "success_criterion" : candidate.type,
    proposedRelation: candidate.predicate,
    payload: {
      subject: candidate.subject,
      predicate: candidate.predicate,
      object: candidate.object,
      scopeType: candidate.scope_type,
      scopeId: candidate.scope_id
    },
    confidence: candidate.confidence,
    risk: candidate.risk,
    evidenceQuote: candidate.evidence_quote,
    locale
  };
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function resolveAssistantReplyLocale(settings: Settings): ResolvedAssistantReplyLocale {
  return settings.assistantReplyLocale === "follow_ui" ? settings.uiLocale : settings.assistantReplyLocale;
}
