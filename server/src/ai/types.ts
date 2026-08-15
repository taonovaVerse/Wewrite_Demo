export type Layer = 'autocomplete' | 'detail' | 'continue' | 'assistant';

export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
}

export interface AiConfig {
  providers: Record<string, ProviderConfig>;
  routing: Record<Layer, string>;
}

export interface StreamRequest {
  system: string;
  user: string;
  /** 将 user 前缀标记为可缓存（Anthropic prompt caching） */
  cachePrefix?: boolean;
  signal: AbortSignal;
}
