import type { LlmConversationInput, LlmExtractionInput, LlmProvider, LlmTextResult } from "./provider.js";

export class MockLlmProvider implements LlmProvider {
  readonly name = "mock";

  async generateAssistantReply(input: LlmConversationInput): Promise<LlmTextResult> {
    return {
      content: input.replyLocale === "zh-CN"
        ? `Sedna 已收到：${input.ownerMessage}`
        : `Sedna heard: ${input.ownerMessage}`,
      provider: "mock",
      model: "mock-deterministic"
    };
  }

  async streamAssistantReply(
    input: LlmConversationInput,
    onDelta: (delta: string) => void | Promise<void>
  ): Promise<LlmTextResult> {
    const reply = await this.generateAssistantReply(input);
    for (const chunk of chunkText(reply.content)) {
      await onDelta(chunk);
    }
    return reply;
  }

  async extractMemoryCandidates(input: LlmExtractionInput): Promise<unknown> {
    const candidates = deterministicExtract(input.ownerMessage);
    return { candidates };
  }
}

function deterministicExtract(content: string) {
  const candidates: unknown[] = [];
  const preferenceMatch = content.match(/\bprefer(?:s|red|ring)?\s+([^.!?]+)/i);
  if (preferenceMatch?.[1]) {
    const value = cleanPhrase(preferenceMatch[1]);
    candidates.push({
      type: "preference",
      label: `Prefers ${value}`,
      subject: "owner",
      predicate: "prefers",
      object: value,
      scope_type: "global",
      scope_id: null,
      confidence: 0.91,
      risk: "low",
      evidence_quote: content
    });
  }

  const projectMatch = content.match(/\bproject\s+(?:is|called|named)\s+([^.!?]+)/i);
  if (projectMatch?.[1]) {
    const value = cleanPhrase(projectMatch[1]);
    candidates.push({
      type: "project",
      label: value,
      subject: "owner",
      predicate: "works_on",
      object: value,
      scope_type: "global",
      scope_id: null,
      confidence: 0.78,
      risk: "medium",
      evidence_quote: content
    });
  }

  const neverMatch = content.match(/\bnever\s+([^.!?]+)/i);
  if (neverMatch?.[1]) {
    const value = `Never ${cleanPhrase(neverMatch[1])}`;
    candidates.push({
      type: "constraint",
      label: value,
      subject: "owner",
      predicate: "requires",
      object: value,
      scope_type: "global",
      scope_id: null,
      confidence: 0.88,
      risk: "high",
      evidence_quote: content
    });
  }

  return candidates;
}

function cleanPhrase(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/^that\s+/i, "");
}

function chunkText(content: string): string[] {
  if (content.length <= 16) {
    return [content];
  }
  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += 16) {
    chunks.push(content.slice(index, index + 16));
  }
  return chunks;
}
