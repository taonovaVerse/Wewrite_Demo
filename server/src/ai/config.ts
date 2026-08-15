import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AiConfig, ProviderConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const defaultConfig: AiConfig = {
  providers: {
    anthropic: { apiKey: '', model: 'claude-sonnet-4-6' },
    deepseek: {
      apiKey: '',
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com',
    },
  },
  routing: {
    autocomplete: 'deepseek',
    detail: 'anthropic',
    continue: 'anthropic',
    assistant: 'anthropic',
  },
};

function loadFromEnv(cfg: AiConfig): AiConfig {
  const merged = structuredClone(cfg);
  if (process.env.ANTHROPIC_API_KEY) merged.providers.anthropic.apiKey = process.env.ANTHROPIC_API_KEY;
  if (process.env.DEEPSEEK_API_KEY) merged.providers.deepseek.apiKey = process.env.DEEPSEEK_API_KEY;
  return merged;
}

export function loadConfig(): AiConfig {
  const cfgPath = path.join(__dirname, '..', '..', 'config.json');
  let cfg = defaultConfig;
  if (fs.existsSync(cfgPath)) {
    try {
      cfg = { ...defaultConfig, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) };
    } catch (err) {
      console.warn('[wewrite] config.json 解析失败，使用默认配置:', err);
    }
  }
  return loadFromEnv(cfg);
}

export function resolveProvider(layer: keyof AiConfig['routing']): ProviderConfigWithName {
  const cfg = loadConfig();
  // assistant 未在 config.json 配置时回退到 continue 的 provider，保证零配置改动可用
  const name = cfg.routing[layer] ?? cfg.routing.continue;
  const provider = cfg.providers[name];
  if (!provider) {
    throw new Error(`路由未找到 provider: ${name}（layer=${layer}）`);
  }
  if (!provider.apiKey) {
    throw new Error(`未配置 ${name} 的 API Key。请编辑 server/config.json 或设置环境变量。`);
  }
  return { name, ...provider };
}

export interface ProviderConfigWithName extends ProviderConfig {
  name: string;
}
