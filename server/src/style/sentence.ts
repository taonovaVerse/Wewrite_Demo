import type { MetricAccumulator, SentenceMetrics } from './types.js';
import { splitSentences, cjk } from './text.js';
import { round } from './util.js';

const SHORT_MAX = 8;
const LONG_MIN = 25;

/** 句长累加器：按句末符切句，统计句长分布（汉字数） */
export class SentenceAccumulator implements MetricAccumulator<SentenceMetrics> {
  private lens: number[] = [];

  observe(chapterText: string): void {
    for (const s of splitSentences(chapterText)) {
      const n = cjk(s).length;
      if (n > 0) this.lens.push(n);
    }
  }

  finalize(_ctx: { totalChars: number }): SentenceMetrics {
    const count = this.lens.length;
    if (count === 0) {
      return { count: 0, avgLen: 0, medianLen: 0, shortRatio: 0, longRatio: 0 };
    }
    const sorted = [...this.lens].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mid = Math.floor(count / 2);
    const medianLen = count % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const shortCount = this.lens.filter((n) => n <= SHORT_MAX).length;
    const longCount = this.lens.filter((n) => n > LONG_MIN).length;
    return {
      count,
      avgLen: round(sum / count),
      medianLen: round(medianLen),
      shortRatio: round(shortCount / count, 2),
      longRatio: round(longCount / count, 2),
    };
  }
}
