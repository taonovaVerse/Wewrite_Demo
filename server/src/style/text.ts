// 中文文本边界工具：切句/切段/引号提取/汉字过滤。本模块是全库唯一的文本边界逻辑。

/** 句末符：句号/叹号/问号/省略号/分号 */
export const SENTENCE_END = /[。！？…；]/;

/** 右引号：紧跟句末符时附入前句（对白归属上一句） */
const CLOSING_QUOTES = '」』”’»"';

/** 切句：按句末符分句；连用的句末符（…… / ！！）合成一个；右引号附入前句 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    buf += ch;
    if (SENTENCE_END.test(ch)) {
      // 连用句末符合成一个句末，如「……」「！！」
      while (i + 1 < text.length && SENTENCE_END.test(text[i + 1])) {
        buf += text[i + 1];
        i++;
      }
      // 右引号附入前句，如：她说：“不去了。”
      while (i + 1 < text.length && CLOSING_QUOTES.includes(text[i + 1])) {
        buf += text[i + 1];
        i++;
      }
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = '';
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

/** 按空行（\n\n）分段，丢弃空段 */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const QUOTE_PAIRS: Record<string, string> = { '「': '」', '『': '』', '“': '”', '"': '"' };
const QUOTE_CLOSE = new Set(Object.values(QUOTE_PAIRS));

/**
 * 提取成对的引号内容。用栈匹配最近未闭合的引号（支持嵌套）；
 * 不成对的引号（单开/单闭）忽略。返回 { text 引号内内容, start/end 在原文的区间 }。
 */
export function extractQuotes(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const stack: { ch: string; idx: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (QUOTE_PAIRS[ch]) {
      stack.push({ ch, idx: i });
      continue;
    }
    if (QUOTE_CLOSE.has(ch)) {
      let found = -1;
      for (let j = stack.length - 1; j >= 0; j--) {
        if (QUOTE_PAIRS[stack[j].ch] === ch) {
          found = j;
          break;
        }
      }
      if (found === -1) continue;
      const open = stack[found];
      stack.length = found;
      if (i - open.idx > 1) {
        out.push({ text: text.slice(open.idx + 1, i), start: open.idx, end: i + 1 });
      }
    }
  }
  return out;
}

/** 仅保留汉字（CJK 统一表意文字 U+4E00–U+9FFF） */
export function cjk(text: string): string {
  const m = text.match(/[一-鿿]/g);
  return m ? m.join('') : '';
}
