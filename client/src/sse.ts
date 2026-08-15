export interface SSEEvent {
  type: string;
  text?: string;
  message?: string;
}

/**
 * 读取 SSE 响应体并逐事件回调（data: JSON 帧）。回调返回 false 可提前终止，剩余缓冲不再派发。
 * 流被 AbortController 中断时抛出 AbortError，由调用方处理。
 */
export async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (evt: SSEEvent) => boolean | void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.replace(/^data:\s*/, '').trim();
      if (!line) continue;
      let evt: SSEEvent;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      if (onEvent(evt) === false) return;
    }
  }
}
