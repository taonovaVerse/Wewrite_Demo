import { resolveProvider } from './config.js';
import { streamAnthropic, streamOpenAICompatible } from './providers.js';
import type { Layer, StreamRequest } from './types.js';

/** 本地测试用：流式输出一段示例正文，不调用任何外部 API */
async function* streamMock(_req: StreamRequest): AsyncGenerator<string> {
  const sample =
    '她把关东煮的盖子合上，塑料勺子在汤里搅了两圈。收银机“叮”地响了一声，找零的硬币滚过台面，被男生用手背按住。\n\n“下雨天，路上小心。”他补了一句。\n\n她推门出去，雨已经小了，路灯的光晕里飘着细密的雨丝，地面泛着光，像一条被打湿的河。';
  for (const ch of sample) {
    yield ch;
    await new Promise((r) => setTimeout(r, 8));
  }
}

export async function* streamByLayer(
  layer: Layer,
  req: StreamRequest,
): AsyncGenerator<string> {
  const provider = resolveProvider(layer);
  switch (provider.name) {
    case 'anthropic':
      yield* streamAnthropic(req, provider);
      break;
    case 'deepseek':
      yield* streamOpenAICompatible(req, provider);
      break;
    case 'mock':
      yield* streamMock(req);
      break;
    default:
      throw new Error(`不支持的 provider: ${provider.name}`);
  }
}
