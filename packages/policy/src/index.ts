import type { MemoryStatus, RiskLevel } from "@sedna/protocol";

export type MemoryPolicyDecision = "auto_promote" | "review" | "confirm" | "quarantine";

export interface MemoryPolicyInput {
  risk: RiskLevel;
  confidence: number;
  hasConflict?: boolean;
}

export interface MemoryPolicyResult {
  decision: MemoryPolicyDecision;
  status: MemoryStatus;
  requiresConfirmation: boolean;
  reason: string;
}

const AUTO_PROMOTE_CONFIDENCE = 0.85;

export function evaluateMemoryCandidate(input: MemoryPolicyInput): MemoryPolicyResult {
  if (input.hasConflict) {
    return {
      decision: "quarantine",
      status: "quarantined",
      requiresConfirmation: true,
      reason: "Conflicting memory must be reviewed before it can influence behavior."
    };
  }

  if (input.risk === "high") {
    return {
      decision: "confirm",
      status: "candidate",
      requiresConfirmation: true,
      reason: "High-risk memory requires explicit owner confirmation."
    };
  }

  if (input.risk === "low" && input.confidence >= AUTO_PROMOTE_CONFIDENCE) {
    return {
      decision: "auto_promote",
      status: "active",
      requiresConfirmation: false,
      reason: "Low-risk high-confidence memory can become active automatically."
    };
  }

  return {
    decision: "review",
    status: "candidate",
    requiresConfirmation: false,
    reason: "Memory should remain available for owner review in the Memory Inbox."
  };
}
