import { Router, type Response } from 'express';
import {
  getChapter,
  assembleContinue,
  assembleAutocomplete,
  assembleDetail,
  assembleAssistant,
} from '../ai/context.js';
import { streamByLayer } from '../ai/router.js';

export const aiRouter = Router();

function setSSE(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
}

function sse(res: Response, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** 取【偏离预警】段之后的正文；无预警时返回全文。用于「一段即止」判定 */
function paragraphBody(acc: string): string {
  const wi = acc.indexOf('【偏离预警】');
  if (wi === -1) return acc;
  const ni = acc.indexOf('\n\n', wi);
  return ni === -1 ? acc : acc.slice(ni + 2);
}

aiRouter.post('/autocomplete', async (req, res) => {
  const chapterId = Number(req.body?.chapterId);
  const textBefore = String(req.body?.textBefore ?? '');
  const textAfter = String(req.body?.textAfter ?? '');
  const chapter = getChapter(chapterId);
  if (!chapter) {
    res.status(404).json({ error: '章节不存在' });
    return;
  }

  const { system, user, cachePrefix } = assembleAutocomplete(chapter, textBefore, textAfter);
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  try {
    let text = '';
    for await (const token of streamByLayer('autocomplete', {
      system,
      user,
      cachePrefix,
      signal: controller.signal,
    })) {
      text += token;
      if (text.length > 120) break;
    }
    res.json({ text });
  } catch (err) {
    if (!controller.signal.aborted) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  }
});

aiRouter.post('/detail', async (req, res) => {
  const chapterId = Number(req.body?.chapterId);
  const scenePrompt = String(req.body?.scenePrompt ?? '');
  const before = String(req.body?.before ?? '');
  const chapter = getChapter(chapterId);
  if (!chapter) {
    res.status(404).json({ error: '章节不存在' });
    return;
  }

  const { system, user, cachePrefix, sources } = assembleDetail(chapter, scenePrompt, before);
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  try {
    let text = '';
    for await (const token of streamByLayer('detail', {
      system,
      user,
      cachePrefix,
      signal: controller.signal,
    })) {
      text += token;
    }
    res.json({ text, sources });
  } catch (err) {
    if (!controller.signal.aborted) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  }
});

aiRouter.post('/continue', (req, res) => {
  const chapterId = Number(req.body?.chapterId);
  const chapter = getChapter(chapterId);
  if (!chapter) {
    res.status(404).json({ error: '章节不存在' });
    return;
  }

  const { system, user, cachePrefix } = assembleContinue(chapter);
  setSSE(res);

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  void (async () => {
    try {
      let acc = '';
      let warned = false;
      for await (const token of streamByLayer('continue', {
        system,
        user,
        cachePrefix,
        signal: controller.signal,
      })) {
        acc += token;
        sse(res, { type: 'token', text: token });
        if (!warned && acc.includes('【偏离预警】')) {
          warned = true;
          sse(res, { type: 'warning', text: 'AI 提示可能偏离大纲，请审阅后修改' });
        }
        // 一段即止：正文出现空行（段落分隔）即收尾，防止无限续写
        if (paragraphBody(acc).replace(/^\s+/, '').includes('\n\n')) break;
      }
      sse(res, { type: 'done' });
    } catch (err) {
      if (controller.signal.aborted) {
        sse(res, { type: 'done' });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        sse(res, { type: 'error', message });
      }
    } finally {
      res.end();
    }
  })();
});

aiRouter.post('/assistant', (req, res) => {
  const chapterId = Number(req.body?.chapterId);
  const chapter = getChapter(chapterId);
  if (!chapter) {
    res.status(404).json({ error: '章节不存在' });
    return;
  }

  const rawMode = req.body?.mode;
  const mode: 'ask' | 'rewrite' = rawMode === undefined ? 'ask' : rawMode;
  if (mode !== 'ask' && mode !== 'rewrite') {
    res.status(400).json({ error: 'mode 不合法' });
    return;
  }

  const rawMessages = req.body?.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    res.status(400).json({ error: '缺少消息' });
    return;
  }
  const raw = rawMessages.map((m) => ({
    role: String(m?.role),
    content: String(m?.content ?? ''),
  }));
  if (raw.some((m) => (m.role !== 'user' && m.role !== 'assistant') || !m.content.trim())) {
    res.status(400).json({ error: '消息格式不合法' });
    return;
  }
  // 校验后 role 必为 user/assistant，content 非空
  const messages = raw as { role: 'user' | 'assistant'; content: string }[];

  const originalText = mode === 'rewrite' ? String(req.body?.rewrite?.originalText ?? '').trim() : '';
  if (mode === 'rewrite' && !originalText) {
    res.status(400).json({ error: '缺少原文' });
    return;
  }

  const { system, user, cachePrefix } = assembleAssistant(chapter, messages, mode, originalText);
  setSSE(res);

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  void (async () => {
    try {
      for await (const token of streamByLayer('assistant', {
        system,
        user,
        cachePrefix,
        signal: controller.signal,
      })) {
        sse(res, { type: 'token', text: token });
      }
      sse(res, { type: 'done' });
    } catch (err) {
      if (controller.signal.aborted) {
        sse(res, { type: 'done' });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        sse(res, { type: 'error', message });
      }
    } finally {
      res.end();
    }
  })();
});
