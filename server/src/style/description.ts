import type { MetricAccumulator, DescriptionMetrics } from './types.js';
import { round } from './util.js';

// 感官/动作词小词表：描写强度的规则代理。诚实命名——它是「命中特定具象词」的近似，
// 不是语义判断；只用辨识度高的 2 字具象词，避免单字误伤抽象叙述。
const CUES = [
  // 触觉/体感
  '冰凉', '滚烫', '温热', '湿润', '黏糊', '粗糙', '光滑', '发麻', '刺痛', '发冷',
  '凉意', '闷热', '余温', '汗珠',
  // 嗅觉/味觉
  '气味', '香味', '腥味', '苦味', '甜味', '酸味', '辛辣', '苦涩', '刺鼻', '酸涩',
  // 视觉/听觉
  '昏暗', '明亮', '闪烁', '模糊', '沙沙', '嘎吱', '咕噜', '轰鸣', '低沉', '尖利',
  '微光', '泛白', '泛黄', '雾气', '蒸汽', '滴答', '簌簌', '窸窣', '吱呀',
  // 动作白描
  '攥紧', '捏住', '掀开', '撕下', '拽住', '蹲下', '俯身', '探身', '砸在', '滑落',
  '颤抖', '踉跄', '屏住', '顿住',
  // 具象量词/细节
  '一缕', '一团', '一丝', '一摊', '一颗', '一片', '一滴', '一截',
];

const CUE_RE = new RegExp(
  CUES.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g',
);

/** 感官细节密度累加器：每千字命中的感官/动作词数 */
export class DescriptionAccumulator implements MetricAccumulator<DescriptionMetrics> {
  private hits = 0;

  observe(chapterText: string): void {
    const m = chapterText.match(CUE_RE);
    if (m) this.hits += m.length;
  }

  finalize(ctx: { totalChars: number }): DescriptionMetrics {
    const cuePerThousand = ctx.totalChars > 0 ? round((this.hits * 1000) / ctx.totalChars) : 0;
    return { cuePerThousand };
  }
}
