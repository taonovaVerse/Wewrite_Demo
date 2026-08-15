import type { MetricAccumulator, DialogueMetrics } from './types.js';
import { extractQuotes, cjk } from './text.js';
import { round } from './util.js';

/** 对白累加器：配对引号内汉字 / 全部汉字算占比；另统计对白段数与平均段长 */
export class DialogueAccumulator implements MetricAccumulator<DialogueMetrics> {
  private quotedChars = 0;
  private segLens: number[] = [];

  observe(chapterText: string): void {
    const clean = chapterText.replace(/\s/g, '');
    for (const q of extractQuotes(clean)) {
      const n = cjk(q.text).length;
      if (n > 0) {
        this.quotedChars += n;
        this.segLens.push(n);
      }
    }
  }

  finalize(ctx: { totalChars: number }): DialogueMetrics {
    const segmentCount = this.segLens.length;
    const ratio = ctx.totalChars > 0 ? this.quotedChars / ctx.totalChars : 0;
    const avgSegLen =
      segmentCount > 0 ? this.segLens.reduce((a, b) => a + b, 0) / segmentCount : 0;
    return {
      ratio: round(ratio, 2),
      segmentCount,
      avgSegLen: round(avgSegLen),
    };
  }
}
