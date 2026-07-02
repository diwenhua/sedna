export async function readSseStream(
  response: Response,
  onEvent: (event: Record<string, unknown>) => Promise<string>
): Promise<string> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Provider request failed: ${response.status} ${text.slice(0, 500)}`);
  }
  if (!response.body) {
    throw new Error("Provider stream response did not include a body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      fullText += await handleSseBlock(block, onEvent);
    }
  }

  if (buffer.trim().length > 0) {
    fullText += await handleSseBlock(buffer, onEvent);
  }

  return fullText;
}

async function handleSseBlock(
  block: string,
  onEvent: (event: Record<string, unknown>) => Promise<string>
): Promise<string> {
  const dataLines = block
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  let text = "";
  for (const data of dataLines) {
    if (data === "[DONE]" || data.length === 0) {
      continue;
    }
    text += await onEvent(JSON.parse(data) as Record<string, unknown>);
  }
  return text;
}
