import type { SlsChecker, SlsDiagnostic } from './types.js';
import { findAll } from './util.js';

/**
 * 人物行为检查（规则型，纯统计基线）。
 * 从更早章节统计某人物附近出现过的强行为动词集合作为基线；
 * 当前正文出现基线外的行为动词 → info 提示确认是人物转变还是笔误（防吃书）。
 * 门槛：前文出现 ≥2 次才纳基，杜绝「前文没写就不该写」对新登场人物的误报。
 */
export const characterBehaviorChecker: SlsChecker = {
  id: 'character-behavior',
  run(doc: string, ctx): SlsDiagnostic[] {
    if (ctx.priorChapters.length === 0) return [];
    const prior = ctx.priorChapters.join('\n');
    const out: SlsDiagnostic[] = [];
    for (const ch of ctx.characters) {
      const name = ch.name.trim();
      if (!name) continue;
      const priorHits = findAll(prior, name);
      if (priorHits.length < MIN_PRIOR_HITS) continue;
      const baseline = new Set<string>();
      for (const h of priorHits) {
        for (const v of scanVerbs(prior, h.from, h.to)) baseline.add(v.verb);
      }
      const reported = new Set<string>();
      for (const h of findAll(doc, name)) {
        for (const { verb, from, to } of scanVerbs(doc, h.from, h.to)) {
          if (baseline.has(verb) || reported.has(verb)) continue;
          reported.add(verb);
          out.push({
            from,
            to,
            severity: 'info',
            source: 'character-behavior',
            message: `人物「${name}」前文（近几章）未见「${verb}」这样的表现，请确认是人物转变还是笔误。`,
          });
        }
      }
    }
    return out;
  },
};

/** 在文本 [start,end) 的 ±WINDOW 字符邻域内扫出命中行为动词的区间 */
function scanVerbs(
  text: string,
  start: number,
  end: number,
): { verb: string; from: number; to: number }[] {
  const from = Math.max(0, start - WINDOW);
  const to = Math.min(text.length, end + WINDOW);
  const windowText = text.slice(from, to);
  const hits: { verb: string; from: number; to: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = VERB_RE.exec(windowText)) !== null) {
    hits.push({ verb: m[0], from: from + m.index, to: from + m.index + m[0].length });
  }
  return hits;
}

const WINDOW = 10;
const MIN_PRIOR_HITS = 2;

// 强行为动词小词表（2 字白描），作为「人物表现」的规则代理。诚实命名：只统计出现，非语义判断。
const BEHAVIOR_VERBS = [
  '大笑', '冷笑', '嗤笑', '微笑', '苦笑', '狂笑', '狞笑',
  '皱眉', '挑眉', '眯眼', '瞪眼', '咬牙',
  '攥拳', '握拳', '握紧',
  '颤抖', '哆嗦', '哽咽', '落泪', '垂泪', '长叹', '叹气', '叹息',
  '沉默', '顿住', '愣住', '屏息', '屏住',
  '踱步', '徘徊', '起身', '站定', '转身', '迈步', '跨步', '驻足',
  '俯身', '探身', '弯身', '蹲下', '坐下',
  '攥紧', '摩挲', '搓手', '掐住', '掀开', '拽住', '掀起', '捏住',
];

const VERB_RE = new RegExp(
  BEHAVIOR_VERBS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g',
);
