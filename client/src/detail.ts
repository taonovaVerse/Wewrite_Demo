import { apiUrl } from './apiBase';
import { app, activeChapterId } from './app';
import { ask } from './quickInput';
import { setAiStatus } from './status';

interface Range {
  from: number;
  to: number;
  text: string;
}

function selectionRange(): Range | null {
  const view = app.editor?.view;
  if (!view) return null;
  const sel = view.state.selection.main;
  if (sel.empty) return null;
  return { from: sel.from, to: sel.to, text: view.state.sliceDoc(sel.from, sel.to) };
}

function before(): string {
  const view = app.editor?.view;
  if (!view) return '';
  const head = view.state.selection.main.head;
  return view.state.sliceDoc(Math.max(0, head - 2000), head);
}

function insert(range: { from: number; to: number } | null, text: string): void {
  const view = app.editor?.view;
  if (!view) return;
  if (range) {
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: text },
      selection: { anchor: range.from + text.length },
    });
  } else {
    const head = view.state.selection.main.head;
    view.dispatch({
      changes: { from: head, insert: text },
      selection: { anchor: head + text.length },
    });
  }
}

function derivePrompt(): string {
  const text = before();
  const m = text.match(/([^。！？…\n]+[。！？…])$/);
  return m ? m[1] : text.slice(-40);
}

export async function triggerDetail(): Promise<void> {
  const chapterId = activeChapterId();
  if (chapterId == null) return;
  const sel = selectionRange();
  let prompt: string | null;
  if (sel && sel.text.trim()) {
    prompt = sel.text.trim();
  } else {
    prompt = await ask('卡壳场景（留空则用最近一句）', '', derivePrompt());
    if (prompt === null) return;
  }
  const range = sel && sel.text.trim() ? { from: sel.from, to: sel.to } : null;

  app.abortCtrl?.abort();
  const ctrl = new AbortController();
  app.abortCtrl = ctrl;
  setAiStatus('生成细节中…（Esc 取消）', 'working');

  try {
    const res = await fetch(apiUrl('/api/ai/detail'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapterId, scenePrompt: prompt, before: before() }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(err?.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { text?: string; sources?: string[] };
    const text = (data.text ?? '').trim();
    if (!text) {
      setAiStatus('✗ 细节生成无内容', 'error');
      return;
    }
    insert(range, text);
    const n = (data.sources ?? []).length;
    setAiStatus(n > 0 ? `✓ 细节已插入 · 匹配素材 ${n} 条` : '✓ 细节已插入', 'ok');
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'AbortError')) {
      setAiStatus('✗ ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  } finally {
    if (app.abortCtrl === ctrl) app.abortCtrl = null;
  }
}
