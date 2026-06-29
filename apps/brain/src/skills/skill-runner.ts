import type { MemoryStore } from "@sedna/memory";

export function testSkill(store: MemoryStore, skillId: string, input: Record<string, unknown> = {}) {
  const skill = store.listSkills().find((item) => item.id === skillId);
  if (!skill) {
    throw new Error(`Skill not found: ${skillId}`);
  }
  if (!skill.enabled) {
    throw new Error(`Skill is disabled: ${skillId}`);
  }
  return store.createSkillRun(skillId, input, {
    thought_summary: `Selected skill ${skill.name} and prepared an audit-safe workflow summary.`,
    required_tools: skill.requiredTools,
    observation: "Skill workflow test completed without external side effects."
  });
}
