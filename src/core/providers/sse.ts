export async function* parseSSE(response: Response): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) throw new Error('SSE response has no body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let eventData: string[] = [];

  const flush = (): Record<string, unknown> | null => {
    if (eventData.length === 0) return null;
    const data = eventData.join('\n').trim();
    eventData = [];
    if (!data || data === '[DONE]') return null;
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const nl = buffer.indexOf('\n');
      if (nl === -1) break;
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);

      // Empty line ends the SSE event
      if (line.length === 0) {
        const evt = flush();
        if (evt) yield evt;
        continue;
      }

      if (line.startsWith('data:')) {
        eventData.push(line.slice(5).trim());
      }
    }
  }

  const finalEvt = flush();
  if (finalEvt) yield finalEvt;
}
