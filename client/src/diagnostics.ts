import { linter, type Diagnostic as LintDiagnostic } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import { apiUrl } from './apiBase';
import { activeChapterId } from './app';

/** 服务端 SLS 返回的诊断（与 server/src/sls/types.ts 对应） */
interface ServerDiagnostic {
  from: number;
  to: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  source: string;
}

/**
 * 调用 /api/sls/check 拿诊断，映射成 CodeMirror lint 格式。
 * 任何失败都静默返回空数组——SLS 不能打断写作。
 * （lint 扩展自带状态校验：若请求期间用户改动了文档/切页，过期结果会被丢弃）
 */
async function checkSls(view: EditorView): Promise<LintDiagnostic[]> {
  const chapterId = activeChapterId();
  if (chapterId == null) return [];
  try {
    const res = await fetch(apiUrl('/api/sls/check'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapterId, text: view.state.doc.toString() }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { diagnostics: ServerDiagnostic[] };
    return data.diagnostics.map((d) => ({
      from: d.from,
      to: d.to,
      severity: d.severity,
      message: d.message,
      source: d.source,
    }));
  } catch {
    return [];
  }
}

/**
 * 接入编辑器：输入停顿 delay 毫秒后静默跑一次 SLS，
 * 命中处画 VS Code 式波浪线，悬停可看中文提示。
 */
export const slsLinter = linter(checkSls, { delay: 1500 });
