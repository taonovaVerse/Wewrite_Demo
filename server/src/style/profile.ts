import type { StyleMetrics } from './types.js';

// 数值 → 中文 voice / rhythm_notes 建议。只输出数值派生 + 阈值分档的定性句，
// 禁用「文笔优美」类空话；全对白/样本小等边界靠分档兜底，不除零。

function pct(r: number): string {
  return `${Math.round(r * 100)}%`;
}

function buildVoice(m: StyleMetrics): string {
  const s = m.sentence;
  const parts: string[] = [];

  if (s.avgLen <= 12) parts.push(`叙述以短句为主（平均约 ${Math.round(s.avgLen)} 字）`);
  else if (s.avgLen <= 20) parts.push(`叙述句长中等（平均约 ${Math.round(s.avgLen)} 字）`);
  else parts.push(`叙述以长句为主（平均约 ${Math.round(s.avgLen)} 字）`);

  if (s.longRatio < 0.08) parts.push('少抒情长句，节奏利落');
  else if (s.longRatio > 0.25) parts.push('长句较多，节奏舒展');

  if (m.dialogue.ratio > 0.45) parts.push(`对白占比约 ${pct(m.dialogue.ratio)}，以对话驱动场景`);
  else if (m.dialogue.ratio > 0.2) parts.push(`对白占约 ${pct(m.dialogue.ratio)}，叙述与对话交织`);
  else parts.push(`对白占比低（约 ${pct(m.dialogue.ratio)}），以叙述推进`);

  if (m.description.cuePerThousand >= 12) parts.push('感官细节密集，偏具象铺陈');
  else if (m.description.cuePerThousand >= 5) parts.push('感官细节适中');
  else parts.push('感官铺陈克制，偏叙事线条');

  if (m.vocabulary.hanziTTR < 0.03) parts.push('用词重复度较高');
  else if (m.vocabulary.hanziTTR < 0.06) parts.push('词汇重复度中等');
  else parts.push('用词较多样');

  let guide: string;
  if (s.avgLen <= 12) guide = '续写时保持干净利落的短句与动作白描，避免长修饰语堆叠。';
  else if (s.avgLen <= 20) guide = '续写时保持中等句长与自然节奏，少用拗口长从句。';
  else guide = '续写时保持舒展的长句节奏，用逗号与顿号控制呼吸。';

  return parts.join('；') + '。' + guide;
}

function buildRhythm(m: StyleMetrics): string {
  const s = m.sentence;
  const p = m.paragraph;
  const d = m.dialogue;
  const parts = [
    `平均句长 ${s.avgLen} 字`,
    `短句（≤8字）占 ${pct(s.shortRatio)}`,
    `长句（>25字）占 ${pct(s.longRatio)}`,
    `段落平均 ${p.avgLen} 字`,
  ];
  if (p.maxLen > 0) parts.push(`最长段 ${p.maxLen} 字`);
  parts.push(`对白占 ${pct(d.ratio)}`);
  if (d.avgSegLen > 0) parts.push(`单段对白平均 ${d.avgSegLen} 字`);
  parts.push(`感官细节约 ${m.description.cuePerThousand} 处/千字`);
  return parts.join('；') + '。';
}

export function buildProfile(metrics: StyleMetrics): { voice: string; rhythm_notes: string } {
  return { voice: buildVoice(metrics), rhythm_notes: buildRhythm(metrics) };
}
