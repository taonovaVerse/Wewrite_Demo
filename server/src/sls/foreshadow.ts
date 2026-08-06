import { extractTerms } from '../ai/detailBank.js';
import type { SlsChecker, SlsDiagnostic } from './types.js';
import { findAll } from './util.js';

/**
 * 前文回响检查（规则型，轻量版 Story Recall）。
 * 从更早章节 + 伏笔表提取关键词，若当前正文再次出现，
 * 提示作者：该元素可能是伏笔/前后呼应的点，建议登记进伏笔表并保持前后一致。
 * 复用 detailBank 的中文关键词提取，避免自造分词。
 * 注意：v1 只取每章开头一段的关键词，属欠采样——少提示比多噪音安全，
 * 后续可升级为实体索引（记录每个实体出现的章节号，直接报告「第 N 章出现过」）。
 */
export const foreshadowChecker: SlsChecker = {
  id: 'foreshadow',
  run(doc: string, ctx): SlsDiagnostic[] {
    const known = new Set<string>();
    for (const content of ctx.priorChapters) {
      for (const term of extractTerms(content, 25)) known.add(term);
    }
    for (const note of ctx.foreshadowNotes) {
      for (const term of extractTerms(note, 10)) known.add(term);
    }
    const out: SlsDiagnostic[] = [];
    for (const term of known) {
      if (term.length < 2) continue;
      for (const { from, to } of findAll(doc, term)) {
        out.push({
          from,
          to,
          severity: 'info',
          source: 'foreshadow',
          message: `「${term}」在前文或伏笔表出现过。若属伏笔，请在伏笔表登记并保持前后一致。`,
        });
      }
    }
    return out;
  },
};
