// SLS 检查器共用的小工具。

/** 找出 doc 中 term 的所有出现区间（from 含 / to 不含） */
export function findAll(doc: string, term: string): { from: number; to: number }[] {
  const hits: { from: number; to: number }[] = [];
  let from = doc.indexOf(term);
  while (from !== -1) {
    hits.push({ from, to: from + term.length });
    from = doc.indexOf(term, from + term.length);
  }
  return hits;
}
