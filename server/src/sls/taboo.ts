import { DEFAULT_TABOO } from '../ai/prompts.js';
import type { SlsChecker, SlsDiagnostic } from './types.js';
import { findAll } from './util.js';

// 作者定义的 AI 腔禁用词（「、」分隔），命中即在编辑器标黄
const TABOO_WORDS = DEFAULT_TABOO.split('、').filter(Boolean);

/**
 * 禁用词检查（规则型，零成本）。
 * 「去 AI 味」的硬校验：把抽象形容词/套路词直接标出来，
 * 提示作者换成具体动作、物件、量词或数字。
 */
export const tabooChecker: SlsChecker = {
  id: 'taboo',
  run(doc: string): SlsDiagnostic[] {
    const out: SlsDiagnostic[] = [];
    for (const word of TABOO_WORDS) {
      for (const { from, to } of findAll(doc, word)) {
        out.push({
          from,
          to,
          severity: 'warning',
          source: 'taboo',
          message: `禁用词「${word}」（AI 腔）。建议换成具体动作、物件、量词或数字。`,
        });
      }
    }
    return out;
  },
};
