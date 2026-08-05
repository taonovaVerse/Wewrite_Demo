import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { StreamRequest, ProviderConfig } from './types.js';

export async function* streamAnthropic(
  req: StreamRequest,
  cfg: ProviderConfig,
): AsyncGenerator<string> {
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const content = req.cachePrefix
    ? [{ type: 'text' as const, text: req.user, cache_control: { type: 'ephemeral' as const } }]
    : req.user;

  const stream = await client.messages.create(
    {
      model: cfg.model,
      max_tokens: 1024,
      system: req.system,
      messages: [{ role: 'user', content }],
      stream: true,
    },
    { signal: req.signal },
  );

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text;
    }
  }
}

export async function* streamOpenAICompatible(
  req: StreamRequest,
  cfg: ProviderConfig,
): AsyncGenerator<string> {
  const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
  const stream = await client.chat.completions.create(
    {
      model: cfg.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      stream: true,
    },
    { signal: req.signal },
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
