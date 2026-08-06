import { Router } from 'express';
import { getChapter } from '../ai/context.js';
import { runSlsCheck } from '../sls/index.js';

export const slsRouter = Router();

/**
 * 轻量 SLS 一致性检查：
 * 前端把当前章节正文发来，服务端跑一组规则型检查器（见 server/src/sls/），
 * 返回编辑器可渲染的诊断（VS Code 式波浪线）。失败不抛错，前端静默降级。
 */
slsRouter.post('/check', (req, res) => {
  const chapterId = Number(req.body?.chapterId);
  if (!Number.isInteger(chapterId)) {
    res.status(400).json({ error: '缺少 chapterId' });
    return;
  }
  const chapter = getChapter(chapterId);
  if (!chapter) {
    res.status(404).json({ error: '章节不存在' });
    return;
  }
  const text = String(req.body?.text ?? '');
  res.json({ diagnostics: runSlsCheck(text, chapter) });
});
