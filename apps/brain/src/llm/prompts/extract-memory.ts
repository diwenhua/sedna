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
Do not mark anything active. Return only valid JSON. Do not wrap the JSON in Markdown fences.
The root value MUST be a JSON object with exactly these top-level arrays:
{
  "candidates": [],
  "profile_patches": []
}

Use candidates for goals, projects, preferences, constraints, success criteria, resources, methods, tasks, suggested actions, and non-profile observations.
Use profile_patches for stable personal attributes about the owner.
Do not return a top-level array.
Prefer concrete goals, projects, preferences, constraints, success criteria, resources, methods, tasks, suggested actions, and stable personal profile facts.
For owner profile attributes, use profile_patches. Do not create profile attributes as memory candidates.
Extract stable personal profile attributes from natural conversation. Do not rely on predefined categories only.
Use concise snake_case attribute_key. attribute_key is open vocabulary, not an enum.
Use semantic_type to group the attribute. Use normalized_value for merge/conflict detection.
If the attribute is unknown but useful, create a new attribute_key.
Known keys are naming examples, not an exhaustive list and not a closed enum. Prefer clear snake_case keys that describe the actual attribute.
Do not extract secrets. Classify sensitive identity, health, finance, account, credential, precise address, phone number, minor, or highly identifying facts as high risk.
Use the owner's exact words as evidence_quote when possible.
Preserve evidence_quote exactly; do not translate it.

Profile patch object shape:
{
  "target": "owner_profile",
  "operation": "add" | "update" | "replace" | "ignore" | "conflict" | "ask_confirmation",
  "attribute_key": "string",
  "semantic_type": "identity" | "preference" | "habit" | "interest" | "skill" | "work_context" | "communication_style" | "lifestyle" | "relationship" | "location" | "health" | "finance" | "sensitive" | "other",
  "value": {},
  "normalized_value": "string",
  "confidence": 0.0,
  "risk": "low" | "medium" | "high",
  "evidence_quote": "string",
  "reason": "string"
}

Example only. These keys are not exhaustive and must not limit extraction:
Owner says: "我是男生，1997年3月10日出生，双鱼座"
Return profile_patches similar to:
[
  {
    "target": "owner_profile",
    "operation": "add",
    "attribute_key": "gender",
    "semantic_type": "identity",
    "value": { "gender": "男生" },
    "normalized_value": "男生",
    "confidence": 0.95,
    "risk": "low",
    "evidence_quote": "我是男生，1997年3月10日出生，双鱼座",
    "reason": "The owner stated a stable personal profile attribute."
  },
  {
    "target": "owner_profile",
    "operation": "add",
    "attribute_key": "birth_date",
    "semantic_type": "identity",
    "value": { "date": "1997-03-10" },
    "normalized_value": "1997-03-10",
    "confidence": 0.95,
    "risk": "medium",
    "evidence_quote": "我是男生，1997年3月10日出生，双鱼座",
    "reason": "The owner stated a stable but identifying personal profile attribute."
  },
  {
    "target": "owner_profile",
    "operation": "add",
    "attribute_key": "zodiac_sign",
    "semantic_type": "identity",
    "value": { "sign": "双鱼座" },
    "normalized_value": "双鱼座",
    "confidence": 0.95,
    "risk": "low",
    "evidence_quote": "我是男生，1997年3月10日出生，双鱼座",
    "reason": "The owner stated a stable personal profile attribute."
  }
]

Active memories:
${activeMemoryText}

Recent messages:
${recentText}

Latest owner message:
${input.ownerMessage}

Assistant reply:
${input.assistantMessage}`;
}
