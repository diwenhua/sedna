import type { ExtractedMemory, MemoryStore } from "@sedna/memory";
import type { MemoryCandidate, Message, ProfileAttribute, ProfilePatchProposal, ResolvedAssistantReplyLocale, Settings } from "@sedna/protocol";
import { ExtractionResultSchema, type ExtractedMemoryCandidate, type ExtractedProfilePatchProposal } from "../llm/schemas.js";
import type { LlmConversationInput, LlmProvider } from "../llm/provider.js";
import { canUseAgentToolLoop, runChatWithWebTools, type ChatToolProgressEvent } from "../agent/chat-tool-loop.js";
import { buildWorkerInventoryContext } from "../agent/worker-actions.js";
import { resolveMessageMentions } from "./mentions.js";

export interface ConversationMessageFlowInput {
  store: MemoryStore;
  provider: LlmProvider;
  conversationId: string;
  content: string;
  fetchImpl?: typeof fetch;
  onProgress?: (event: ConversationMessageFlowEvent) => void | Promise<void>;
}

export interface ConversationMessageFlowResult {
  ownerMessage: Message;
  assistantMessage: Message;
  candidates: MemoryCandidate[];
  profileAttributes: ProfileAttribute[];
}

export type ConversationMessageFlowEvent =
  | { type: "owner_message"; message: Message }
  | { type: "assistant_status"; phase: "thinking" | "reply_ready" | "memory_extraction" | "done"; title: string }
  | { type: "assistant_delta"; content: string }
  | { type: "assistant_message"; message: Message }
  | { type: "memory_candidates"; candidates: MemoryCandidate[] }
  | { type: "profile_attributes"; attributes: ProfileAttribute[] }
  | { type: "tool_status"; tool: string; phase: "search" | "fetch" | "tool"; title: string; query?: string; url?: string }
  | { type: "tool_result"; tool: string; summary: string }
  | { type: "error"; message: string };

export async function runConversationMessageFlow(
  input: ConversationMessageFlowInput
): Promise<ConversationMessageFlowResult> {
  const settings = input.store.getSettings();
  const replyLocale = resolveAssistantReplyLocale(settings);
  const resolvedMentions = resolveMessageMentions(input.store, input.content);
  const ownerMessage = input.store.createMessage(input.conversationId, "owner", input.content, {
    locale: settings.uiLocale,
    ...(resolvedMentions.skills.length > 0 || resolvedMentions.tools.length > 0
      ? {
          mentions: {
            skills: resolvedMentions.skills.map((skill) => ({ id: skill.id, name: skill.name })),
            tools: resolvedMentions.tools.map((tool) => ({ id: tool.id, name: tool.name }))
          }
        }
      : {})
  });
  input.store.recordMessageCreatedEvent(ownerMessage, "Owner message created");
  input.store.recordAuditRecord("owner", "message.create", "message", ownerMessage.id, {
    conversationId: input.conversationId,
    skillMentions: resolvedMentions.skills.map((skill) => skill.name),
    toolMentions: resolvedMentions.tools.map((tool) => tool.name)
  });
  await input.onProgress?.({ type: "owner_message", message: ownerMessage });
  for (const skill of resolvedMentions.skills) {
    input.store.createSkillRun(
      skill.id,
      { ownerMessage: input.content, conversationId: input.conversationId },
      { appliedToChat: true, skillName: skill.name }
    );
  }
  const thinkingTitle = resolvedMentions.skills.length > 0
    ? `Using skill: ${resolvedMentions.skills.map((skill) => skill.name).join(", ")}`
    : resolvedMentions.tools.length > 0
      ? `Using tools: ${resolvedMentions.tools.map((tool) => tool.name).join(", ")}`
      : "Thinking";
  await input.onProgress?.({ type: "assistant_status", phase: "thinking", title: thinkingTitle });

  const recentMessages = input.store
    .listRecentMessages(input.conversationId, 12)
    .filter((message) => message.id !== ownerMessage.id);
  const useAgentToolLoop = canUseAgentToolLoop(input.store);
  const activeMemories = useAgentToolLoop ? [] : input.store.listActiveMemoryNodes(input.content, 12);
  const workerInventory = buildWorkerInventoryContext(input.store);

  let assistantContent: string;
  let assistantMetadata: Record<string, unknown>;
  const replyInput: LlmConversationInput = {
    ownerMessage: input.content,
    recentMessages,
    activeMemories,
    replyLocale,
    workerInventory,
    agentToolsEnabled: useAgentToolLoop,
    selectedSkills: resolvedMentions.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      instructionMarkdown: skill.instructionMarkdown,
      requiredTools: skill.requiredTools
    })),
    selectedTools: resolvedMentions.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      source: tool.source
    }))
  };
  try {
    const reply = useAgentToolLoop
      ? await runChatWithWebTools(replyInput, {
          store: input.store,
          fetchImpl: input.fetchImpl,
          onDelta: async (delta) => {
            await input.onProgress?.({ type: "assistant_delta", content: delta });
          },
          onProgress: async (event: ChatToolProgressEvent) => {
            await input.onProgress?.(event);
          }
        })
      : input.provider.streamAssistantReply
        ? await input.provider.streamAssistantReply(replyInput, async (delta) => {
            await input.onProgress?.({ type: "assistant_delta", content: delta });
          })
        : await input.provider.generateAssistantReply(replyInput);
    assistantContent = reply.content;
    assistantMetadata = {
      generatedFrom: ownerMessage.id,
      provider: reply.provider,
      model: reply.model,
      locale: replyLocale,
      ...(useAgentToolLoop ? { agentToolsUsed: true } : {}),
      ...(resolvedMentions.skills.length > 0 ? { skillsUsed: resolvedMentions.skills.map((skill) => skill.name) } : {})
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

  const extractedMemories: ExtractedMemory[] = [];
  const profilePatchProposals: ProfilePatchProposal[] = [];
  if (!("error" in assistantMetadata)) {
    try {
      await input.onProgress?.({ type: "assistant_status", phase: "memory_extraction", title: "Extracting memory candidates" });
      const rawExtraction = await input.provider.extractMemoryCandidates({
        ownerMessage: input.content,
        assistantMessage: assistantContent,
        recentMessages: input.store.listRecentMessages(input.conversationId, 12),
        activeMemories: input.store.listActiveMemoryNodes(input.content, 12),
        replyLocale
      });
      const parsed = ExtractionResultSchema.parse(rawExtraction);
      for (const candidate of parsed.candidates) {
        extractedMemories.push(toExtractedMemory(candidate, ownerMessage.locale));
      }
      for (const proposal of parsed.profile_patches) {
        profilePatchProposals.push(toProfilePatchProposal(proposal));
      }
    } catch (error) {
      input.store.recordMemoryExtractionFailure(
        input.conversationId,
        assistantMessage.id,
        normalizeError(error),
        input.provider.name
      );
    }
  }

  const candidates = input.store.createMemoryCandidatesFromMessage(ownerMessage, extractedMemories);
  if (candidates.length > 0) {
    await input.onProgress?.({ type: "memory_candidates", candidates });
  }
  const profileAttributes = profilePatchProposals
    .map((proposal) => input.store.applyProfilePatchProposal(proposal, ownerMessage))
    .filter((attribute): attribute is ProfileAttribute => Boolean(attribute));
  if (profileAttributes.length > 0) {
    await input.onProgress?.({ type: "profile_attributes", attributes: profileAttributes });
  }
  await input.onProgress?.({ type: "assistant_status", phase: "done", title: "Done" });

  return {
    ownerMessage,
    assistantMessage,
    candidates,
    profileAttributes
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

function toProfilePatchProposal(proposal: ExtractedProfilePatchProposal): ProfilePatchProposal {
  return {
    target: proposal.target,
    operation: proposal.operation,
    attributeKey: proposal.attribute_key,
    semanticType: proposal.semantic_type,
    value: proposal.value,
    normalizedValue: proposal.normalized_value,
    confidence: proposal.confidence,
    risk: proposal.risk,
    evidenceQuote: proposal.evidence_quote,
    reason: proposal.reason
  };
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function resolveAssistantReplyLocale(settings: Settings): ResolvedAssistantReplyLocale {
  return settings.assistantReplyLocale === "follow_ui" ? settings.uiLocale : settings.assistantReplyLocale;
}
