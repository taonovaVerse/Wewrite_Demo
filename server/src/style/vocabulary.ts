import type { MetricAccumulator, VocabularyMetrics } from './types.js';
import { cjk } from './text.js';
import { round } from './util.js';

// 停用字：滤掉最常见虚字，让高频三字短语更像「口头禅」而非语法骨架（复用 detailBank 的 STOP 思路）
const STOP = new Set(
  '的了在是把我被你着她他们和与及就将着这那几个很都也就才又再不没有为而但却只呢吧啊呀么何我们你们咱们自己这那之乎者',
);

const TOP_N = 8;

/** 词汇多样性累加器：汉字 TTR、bigram TTR、高频三字短语 */
export class VocabularyAccumulator implements MetricAccumulator<VocabularyMetrics> {
  private hanziTotal = 0;
  private hanziTypes = new Set<string>();
  private bigramTotal = 0;
  private bigramTypes = new Set<string>();
  private trigramCount = new Map<string, number>();

  observe(chapterText: string): void {
    const chars = [...cjk(chapterText)];
    for (const ch of chars) {
      this.hanziTotal++;
      this.hanziTypes.add(ch);
    }
    for (let i = 0; i + 1 < chars.length; i++) {
      this.bigramTotal++;
      this.bigramTypes.add(chars[i] + chars[i + 1]);
    }
    for (let i = 0; i + 2 < chars.length; i++) {
      if (STOP.has(chars[i]) || STOP.has(chars[i + 1]) || STOP.has(chars[i + 2])) continue;
      const tg = chars[i] + chars[i + 1] + chars[i + 2];
      this.trigramCount.set(tg, (this.trigramCount.get(tg) ?? 0) + 1);
    }
  }

  finalize(_ctx: { totalChars: number }): VocabularyMetrics {
    const hanziTTR = this.hanziTotal > 0 ? round(this.hanziTypes.size / this.hanziTotal, 3) : 0;
    const bigramTTR = this.bigramTotal > 0 ? round(this.bigramTypes.size / this.bigramTotal, 3) : 0;
    const topTrigrams = [...this.trigramCount.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_N)
      .map(([w]) => w);
    return { hanziTTR, bigramTTR, topTrigrams };
  }
}
