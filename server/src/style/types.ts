// 文风学习（L5）共享类型。
// 累加器模式：每个指标一个累加器，observe 喂整章正文（单遍扫描），finalize 合成指标。
// 参考 server/src/sls/ 的检查器拆分：文件小、纯函数、可单测。

/** 累加器契约：入参整章正文；finalize 时带上全局上下文（总汉字数）合成指标 */
export interface MetricAccumulator<T> {
  observe(chapterText: string): void;
  finalize(ctx: { totalChars: number }): T;
}

/** 句长分布 */
export interface SentenceMetrics {
  count: number;
  /** 平均句长（汉字数） */
  avgLen: number;
  /** 中位句长 */
  medianLen: number;
  /** 短句（≤8 字）占比 */
  shortRatio: number;
  /** 长句（>25 字）占比 */
  longRatio: number;
}

/** 段落长度 */
export interface ParagraphMetrics {
  count: number;
  avgLen: number;
  maxLen: number;
}

/** 对白 */
export interface DialogueMetrics {
  /** 引号内汉字 / 全部汉字 */
  ratio: number;
  segmentCount: number;
  avgSegLen: number;
}

/** 感官细节密度（描写强度的规则代理，诚实命名，非严格语义判定） */
export interface DescriptionMetrics {
  /** 每千字命中的感官/动作词数量 */
  cuePerThousand: number;
}

/** 词汇多样性 */
export interface VocabularyMetrics {
  /** 汉字类符/形符比（types/tokens，越低越重复） */
  hanziTTR: number;
  /** 2 字 bigram TTR */
  bigramTTR: number;
  /** 高频三字短语（已滤停用字，提示作者口头禅，不写入 taboo） */
  topTrigrams: string[];
}

export interface StyleMetrics {
  /** 扫描的章节数 */
  chapterCount: number;
  /** 全部章节汉字总数 */
  totalChars: number;
  sentence: SentenceMetrics;
  paragraph: ParagraphMetrics;
  dialogue: DialogueMetrics;
  description: DescriptionMetrics;
  vocabulary: VocabularyMetrics;
}

export interface StyleAnalyzeResult {
  metrics: StyleMetrics;
  meta: { chaptersScanned: number; note?: string };
  generated: { voice: string; rhythm_notes: string };
}
