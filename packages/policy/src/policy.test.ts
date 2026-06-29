import { describe, expect, it } from "vitest";
import { evaluateMemoryCandidate } from "./index.js";

describe("memory policy", () => {
  it("auto-promotes high-confidence low-risk memory", () => {
    expect(
      evaluateMemoryCandidate({ risk: "low", confidence: 0.92, hasConflict: false })
    ).toEqual({
      decision: "auto_promote",
      status: "active",
      requiresConfirmation: false,
      reason: "Low-risk high-confidence memory can become active automatically."
    });
  });

  it("keeps medium-risk memory in the inbox", () => {
    expect(
      evaluateMemoryCandidate({ risk: "medium", confidence: 0.86, hasConflict: false })
    ).toMatchObject({
      decision: "review",
      status: "candidate",
      requiresConfirmation: false
    });
  });

  it("requires explicit confirmation for high-risk memory", () => {
    expect(
      evaluateMemoryCandidate({ risk: "high", confidence: 0.96, hasConflict: false })
    ).toMatchObject({
      decision: "confirm",
      status: "candidate",
      requiresConfirmation: true
    });
  });

  it("quarantines conflicts before promotion", () => {
    expect(
      evaluateMemoryCandidate({ risk: "low", confidence: 0.96, hasConflict: true })
    ).toMatchObject({
      decision: "quarantine",
      status: "quarantined",
      requiresConfirmation: true
    });
  });
});
