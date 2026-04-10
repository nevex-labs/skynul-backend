function extractLines(buffer: string): { lines: string[]; remaining: string } {
  const lines: string[] = [];
  let remaining = buffer;
  let nl = remaining.indexOf('\n');
  while (nl !== -1) {
    lines.push(remaining.slice(0, nl).replace(/\r$/, ''));
    remaining = remaining.slice(nl + 1);
    nl = remaining.indexOf('\n');
  }
  return { lines, remaining };
}

function tryParseEvent(eventData: string[]): Record<string, unknown> | null {
  if (eventData.length === 0) return null;
  const data = eventData.join('\n').trim();
  if (!data || data === '[DONE]') return null;
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function processLines(lines: string[], eventData: string[]): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const line of lines) {
    if (line.length === 0) {
      const evt = tryParseEvent(eventData);
      eventData.splice(0);
      if (evt) events.push(evt);
    } else if (line.startsWith('data:')) {
      eventData.push(line.slice(5).trim());
    }
  }
  return events;
}

export async function* parseSSE(response: Response): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) throw new Error('SSE response has no body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const eventData: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { lines, remaining } = extractLines(buffer);
    buffer = remaining;
    for (const evt of processLines(lines, eventData)) yield evt;
  }

  const finalEvt = tryParseEvent(eventData);
  if (finalEvt) yield finalEvt;
}
