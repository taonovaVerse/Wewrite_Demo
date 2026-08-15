import type { MetricAccumulator, ParagraphMetrics } from './types.js';
import { splitParagraphs, cjk } from './text.js';
import { round } from './util.js';

/** 段落累加器：按空行分段，统计段落长度分布 */
export class ParagraphAccumulator implements MetricAccumulator<ParagraphMetrics> {
  private lens: number[] = [];

  observe(chapterText: string): void {
    for (const p of splitParagraphs(chapterText)) {
      const n = cjk(p).length;
      if (n > 0) this.lens.push(n);
    }
  }

  finalize(_ctx: { totalChars: number }): ParagraphMetrics {
    const count = this.lens.length;
    if (count === 0) return { count: 0, avgLen: 0, maxLen: 0 };
    const sum = this.lens.reduce((a, b) => a + b, 0);
    return {
      count,
      avgLen: round(sum / count),
      maxLen: Math.max(...this.lens),
    };
  }
}
