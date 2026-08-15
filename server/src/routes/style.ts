import { Router } from 'express';
import { novelById } from '../fs/registry.js';
import { styleAnalyze, StyleInsufficientError } from '../style/index.js';

export const styleRouter = Router();

/**
 * L5 文风分析：纯规则统计全部章节正文，返回指标 + 生成的 voice/rhythm_notes 建议。
 * 不自动写盘——前端预览后由作者手动填入并保存（尊重「人做船长」）。
 */
styleRouter.post('/analyze', (req, res) => {
  const novelId = Number(req.body?.novelId);
  if (!Number.isInteger(novelId) || novelId <= 0) {
    res.status(400).json({ error: '缺少 novelId' });
    return;
  }
  if (!novelById(novelId)) {
    res.status(404).json({ error: '小说不存在' });
    return;
  }
  try {
    res.json(styleAnalyze(novelId));
  } catch (err) {
    if (err instanceof StyleInsufficientError) {
      res.status(400).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
