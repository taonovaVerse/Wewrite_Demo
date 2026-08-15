import type { StyleMetrics } from './types.js';
import { cjk } from './text.js';
import { SentenceAccumulator } from './sentence.js';
import { ParagraphAccumulator } from './paragraph.js';
import { DialogueAccumulator } from './dialogue.js';
import { DescriptionAccumulator } from './description.js';
import { VocabularyAccumulator } from './vocabulary.js';

/** 单遍扫描全部章节，喂各累加器，finalize 合成 StyleMetrics */
export function analyzeChapters(chapters: { content: string }[]): {
  metrics: StyleMetrics;
  totalChars: number;
} {
  const sentence = new SentenceAccumulator();
  const paragraph = new ParagraphAccumulator();
  const dialogue = new DialogueAccumulator();
  const description = new DescriptionAccumulator();
  const vocabulary = new VocabularyAccumulator();

  let totalChars = 0;
  for (const ch of chapters) {
    sentence.observe(ch.content);
    paragraph.observe(ch.content);
    dialogue.observe(ch.content);
    description.observe(ch.content);
    vocabulary.observe(ch.content);
    totalChars += cjk(ch.content).length;
  }

  const ctx = { totalChars };
  return {
    totalChars,
    metrics: {
      chapterCount: chapters.length,
      totalChars,
      sentence: sentence.finalize(ctx),
      paragraph: paragraph.finalize(ctx),
      dialogue: dialogue.finalize(ctx),
      description: description.finalize(ctx),
      vocabulary: vocabulary.finalize(ctx),
    },
  };
}
