import { EditorView, WidgetType, Decoration, keymap, ViewPlugin } from '@codemirror/view';
import {
  StateField,
  StateEffect,
  Prec,
  type Extension,
  type Range,
  type RangeSet,
} from '@codemirror/state';
import { activeChapterId } from './app';
import { apiUrl } from './apiBase';
import { el } from './ui';
import { consumeSSE } from './sse';

// ---------- 类型 ----------

interface RewritePanel {
  from: number;
  to: number;
  originalText: string;
}

interface RewriteToolbar {
  from: number;
  to: number;
  text: string;
}

interface InlineRewriteState {
  panel: RewritePanel | null;
  toolbar: RewriteToolbar | null;
}

// ---------- effects / field ----------

const openRewriteEffect = StateEffect.define<RewritePanel>();
const closeRewriteEffect = StateEffect.define<null>();

const inlineRewriteField = StateField.define<InlineRewriteState>({
  create: () => ({ panel: null, toolbar: null }),
  update(state, tr) {
    let panel = state.panel;
    for (const e of tr.effects) {
      if (e.is(openRewriteEffect)) return { panel: e.value, toolbar: null };
      if (e.is(closeRewriteEffect)) panel = null;
    }
    if (panel && tr.docChanged) {
      // 原文区间随文档编辑映射；区间被删空则关闭面板
      const from = tr.changes.mapPos(panel.from, 1);
      const to = tr.changes.mapPos(panel.to, -1);
      panel = from < to ? { from, to, originalText: panel.originalText } : null;
    }
    let toolbar: RewriteToolbar | null = null;
    if (!panel) {
      const sel = tr.state.selection.main;
      if (!sel.empty) {
        const text = tr.state.sliceDoc(sel.from, sel.to);
        if (text.trim()) toolbar = { from: sel.from, to: sel.to, text };
      }
    }
    return { panel, toolbar };
  },
});

// ---------- 选区工具条（inline widget） ----------

class ToolbarWidget extends WidgetType {
  constructor(readonly toolbar: RewriteToolbar) {
    super();
  }
  eq(other: ToolbarWidget): boolean {
    return other.toolbar.from === this.toolbar.from && other.toolbar.to === this.toolbar.to;
  }
  toDOM(): HTMLElement {
    const btn = el('button', 'rw-toolbar', '✨ 改写');
    btn.title = '改写选中段落';
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      const view = viewRef;
      const t = view?.state.field(inlineRewriteField).toolbar;
      if (!view || !t) return;
      view.dispatch({
        effects: openRewriteEffect.of({ from: t.from, to: t.to, originalText: t.text }),
      });
      view.requestMeasure();
      window.setTimeout(() => {
        const input = view.dom.querySelector('.rw-prompt') as HTMLInputElement | null;
        input?.focus();
      }, 20);
    });
    return btn;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

// ---------- 内联改写面板（block widget） ----------

const DEFAULT_PROMPT = '请改写这段，保留原意，贴合作者文风';

let streamCtrl: AbortController | null = null;

// 编辑器视图引用：面板输入框位于 block widget 内部（非 CM tile），
// EditorView.findFromDOM 无法定位，故由文末 viewCapture 插件捕获到模块闭包。
let viewRef: EditorView | null = null;

/** 从面板内任意节点定位面板的输入/草稿/状态/按钮元素 */
function panelRefs(node: HTMLElement): {
  prompt: HTMLInputElement;
  draft: HTMLElement;
  status: HTMLElement;
  accept: HTMLButtonElement;
} | null {
  const root = node.closest('.rw-panel') as HTMLElement | null;
  if (!root) return null;
  const prompt = root.querySelector('.rw-prompt') as HTMLInputElement | null;
  const draft = root.querySelector('.rw-draft') as HTMLElement | null;
  const status = root.querySelector('.rw-status') as HTMLElement | null;
  const accept = root.querySelector('.rw-accept') as HTMLButtonElement | null;
  if (!prompt || !draft || !status || !accept) return null;
  return { prompt, draft, status, accept };
}

class PanelWidget extends WidgetType {
  constructor(readonly panel: RewritePanel) {
    super();
  }
  eq(other: PanelWidget): boolean {
    return other.panel.from === this.panel.from && other.panel.to === this.panel.to;
  }
  toDOM(): HTMLElement {
    const root = el('div', 'rw-panel');

    const promptRow = el('div', 'rw-prompt-row');
    const input = el('input', 'rw-prompt') as HTMLInputElement;
    input.placeholder = `改写要求（留空按默认：${DEFAULT_PROMPT}）`;
    input.spellcheck = false;
    const send = el('button', 'btn rw-send', '改写');
    promptRow.append(input, send);

    const draft = el('div', 'rw-draft');
    const status = el('div', 'rw-status');
    const actions = el('div', 'rw-actions');
    const accept = el('button', 'btn rw-accept', '应用') as HTMLButtonElement;
    accept.disabled = true;
    accept.title = '把改写稿替换进正文';
    const cancel = el('button', 'btn btn-danger rw-cancel', '放弃') as HTMLButtonElement;
    actions.append(accept, cancel);

    root.append(promptRow, draft, status, actions);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void startRewrite(input);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closePanel();
      }
    });
    send.addEventListener('click', () => void startRewrite(input));
    cancel.addEventListener('click', () => closePanel());
    accept.addEventListener('click', () => acceptRewrite(input));
    return root;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

// ---------- 装饰 ----------

const rewriteDecorations = StateField.define<RangeSet<Decoration>>({
  create: () => Decoration.none,
  update(_deco, tr) {
    const s = tr.state.field(inlineRewriteField, false);
    if (!s) return Decoration.none;
    const ranges: Range<Decoration>[] = [];
    if (s.toolbar) {
      ranges.push(
        Decoration.widget({ widget: new ToolbarWidget(s.toolbar), side: 1 }).range(s.toolbar.to),
      );
    }
    if (s.panel) {
      ranges.push(
        Decoration.widget({ widget: new PanelWidget(s.panel), block: true, side: 1 }).range(
          s.panel.to,
        ),
      );
    }
    return Decoration.set(ranges);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---------- 流式改写 ----------

function closePanel(): void {
  streamCtrl?.abort();
  streamCtrl = null;
  viewRef?.dispatch({ effects: closeRewriteEffect.of(null) });
}

async function startRewrite(input: HTMLInputElement): Promise<void> {
  const view = viewRef;
  const st = view?.state.field(inlineRewriteField);
  const refs = panelRefs(input);
  if (!view || !st?.panel || !refs) return;
  const { panel } = st;

  streamCtrl?.abort();
  const ctrl = new AbortController();
  streamCtrl = ctrl;

  const prompt = input.value.trim() || DEFAULT_PROMPT;
  const { draft, status, accept } = refs;
  draft.textContent = '';
  draft.classList.remove('rw-draft-done');
  status.textContent = '改写中…';
  status.classList.remove('rw-status-error');
  accept.disabled = true;
  accept.textContent = '应用';

  const chapterId = activeChapterId();
  if (chapterId == null) {
    status.textContent = '✗ 未打开章节';
    status.classList.add('rw-status-error');
    return;
  }

  try {
    const res = await fetch(apiUrl('/api/ai/assistant'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chapterId,
        mode: 'rewrite',
        messages: [{ role: 'user', content: prompt }],
        rewrite: { originalText: panel.originalText },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      let message = `HTTP ${res.status}`;
      try {
        const b = (await res.json()) as { error?: string };
        if (b.error) message = b.error;
      } catch {
        /* 非 JSON 错误体，保留 HTTP 状态 */
      }
      throw new Error(message);
    }

    await consumeSSE(res.body, (evt) => {
      if (evt.type === 'token' && evt.text) {
        draft.textContent += evt.text;
      } else if (evt.type === 'error') {
        status.textContent = '✗ ' + (evt.message ?? '未知错误');
        status.classList.add('rw-status-error');
      }
    });
    status.textContent = '';
    draft.classList.add('rw-draft-done');
    accept.disabled = false;
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'AbortError')) {
      status.textContent = '✗ ' + (err instanceof Error ? err.message : String(err));
      status.classList.add('rw-status-error');
    }
  } finally {
    if (streamCtrl === ctrl) streamCtrl = null;
  }
}

// ---------- 应用 / 放弃 ----------

function acceptRewrite(input: HTMLInputElement): void {
  const view = viewRef;
  const st = view?.state.field(inlineRewriteField);
  const refs = panelRefs(input);
  if (!view || !st?.panel || !refs) return;
  const { panel } = st;
  const draft = refs.draft.textContent ?? '';
  if (!draft.trim()) return;

  let from = panel.from;
  let to = panel.to;
  if (view.state.sliceDoc(from, to) !== panel.originalText) {
    const idx = view.state.doc.toString().indexOf(panel.originalText);
    if (idx === -1) {
      refs.status.textContent = '✗ 原文已变动，无法定位改写位置';
      refs.status.classList.add('rw-status-error');
      return;
    }
    from = idx;
    to = idx + panel.originalText.length;
  }
  streamCtrl?.abort();
  streamCtrl = null;
  view.dispatch({
    changes: { from, to, insert: draft },
    selection: { anchor: from + draft.length },
    effects: closeRewriteEffect.of(null),
  });
}

// ---------- Escape 与导出 ----------

const escapeKeymap = Prec.highest(
  keymap.of([
    {
      key: 'Escape',
      run: (view) => {
        if (!view.state.field(inlineRewriteField).panel) return false;
        cancelInlineRewrite(view);
        return true;
      },
    },
  ]),
);

/** 关闭改写面板并中断在途流（切页/关页/全局 Escape 时调用；doc 态无此扩展，安全调用） */
export function cancelInlineRewrite(view: EditorView | undefined | null): void {
  if (!view) return;
  streamCtrl?.abort();
  streamCtrl = null;
  if (view.state.field(inlineRewriteField, false)?.panel) {
    view.dispatch({ effects: closeRewriteEffect.of(null) });
  }
}

const viewCapture = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      viewRef = view;
    }
    destroy(): void {
      if (viewRef === this.view) viewRef = null;
    }
  },
);

export const inlineRewrite: Extension = [inlineRewriteField, rewriteDecorations, escapeKeymap, viewCapture];
