export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {};
  }
  return JSON.parse(stripJsonFence(trimmed)) as unknown;
}

function stripJsonFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return text;
}
