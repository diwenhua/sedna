import { z } from "zod";

export const ExtractedMemoryCandidateSchema = z.object({
  type: z.enum([
    "goal",
    "project",
    "preference",
    "constraint",
    "success_criterion",
    "resource",
    "method",
    "task",
    "suggested_action",
    "observation"
  ]),
  label: z.string().min(1),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  scope_type: z.enum(["global", "profile", "project", "resource", "worker", "device"]),
  scope_id: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  risk: z.enum(["low", "medium", "high"]),
  evidence_quote: z.string().min(1)
});

export const ProfilePatchProposalSchema = z.object({
  target: z.literal("owner_profile"),
  operation: z.enum(["add", "update", "replace", "ignore", "conflict", "ask_confirmation"]),
  attribute_key: z.string().min(1),
  semantic_type: z.enum([
    "identity",
    "preference",
    "habit",
    "interest",
    "skill",
    "work_context",
    "communication_style",
    "lifestyle",
    "relationship",
    "location",
    "health",
    "finance",
    "sensitive",
    "other"
  ]),
  value: z.record(z.unknown()),
  normalized_value: z.string().min(1),
  confidence: z.number().min(0).max(1),
  risk: z.enum(["low", "medium", "high"]),
  evidence_quote: z.string().min(1),
  reason: z.string().min(1)
});

export const ExtractionResultSchema = z.object({
  candidates: z.array(ExtractedMemoryCandidateSchema).default([]),
  profile_patches: z.array(ProfilePatchProposalSchema).default([])
});

export type ExtractedMemoryCandidate = z.infer<typeof ExtractedMemoryCandidateSchema>;
export type ExtractedProfilePatchProposal = z.infer<typeof ProfilePatchProposalSchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

export const extractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["candidates", "profile_patches"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "type",
          "label",
          "subject",
          "predicate",
          "object",
          "scope_type",
          "scope_id",
          "confidence",
          "risk",
          "evidence_quote"
        ],
        properties: {
          type: {
            type: "string",
            enum: [
              "goal",
              "project",
              "preference",
              "constraint",
              "success_criterion",
              "resource",
              "method",
              "task",
              "suggested_action",
              "observation"
            ]
          },
          label: { type: "string" },
          subject: { type: "string" },
          predicate: { type: "string" },
          object: { type: "string" },
          scope_type: {
            type: "string",
            enum: ["global", "profile", "project", "resource", "worker", "device"]
          },
          scope_id: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          risk: { type: "string", enum: ["low", "medium", "high"] },
          evidence_quote: { type: "string" }
        }
      }
    },
    profile_patches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "target",
          "operation",
          "attribute_key",
          "semantic_type",
          "value",
          "normalized_value",
          "confidence",
          "risk",
          "evidence_quote",
          "reason"
        ],
        properties: {
          target: { type: "string", enum: ["owner_profile"] },
          operation: { type: "string", enum: ["add", "update", "replace", "ignore", "conflict", "ask_confirmation"] },
          attribute_key: { type: "string" },
          semantic_type: {
            type: "string",
            enum: [
              "identity",
              "preference",
              "habit",
              "interest",
              "skill",
              "work_context",
              "communication_style",
              "lifestyle",
              "relationship",
              "location",
              "health",
              "finance",
              "sensitive",
              "other"
            ]
          },
          value: { type: "object" },
          normalized_value: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          risk: { type: "string", enum: ["low", "medium", "high"] },
          evidence_quote: { type: "string" },
          reason: { type: "string" }
        }
      }
    }
  }
} as const;
