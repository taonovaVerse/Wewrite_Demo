import { listChaptersInOrder } from '../fs/novelFs.js';
import { analyzeChapters } from './analyzer.js';
import { buildProfile } from './profile.js';
import type { StyleAnalyzeResult } from './types.js';

/** 有效正文不足此字数视为「没样本」，路由层降级 400 */
const MIN_CHARS = 500;
/** 低于此字数时在 meta.note 标注样本偏少 */
const SMALL_SAMPLE = 2000;

export class StyleInsufficientError extends Error {}

export function styleAnalyze(novelId: number): StyleAnalyzeResult {
  const chapters = listChaptersInOrder(novelId);
  const { metrics } = analyzeChapters(chapters);
  if (metrics.totalChars < MIN_CHARS) {
    throw new StyleInsufficientError('正文不足，暂无法生成文风建议');
  }
  const meta: { chaptersScanned: number; note?: string } = { chaptersScanned: chapters.length };
  if (metrics.totalChars < SMALL_SAMPLE) meta.note = '样本较少，建议仅供参考';
  return { metrics, meta, generated: buildProfile(metrics) };
}
