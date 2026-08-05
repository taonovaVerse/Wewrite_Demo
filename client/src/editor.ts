import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  WidgetType,
  Decoration,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import {
  EditorState,
  StateField,
  StateEffect,
  Annotation,
  Prec,
  type Extension,
  type RangeSet,
} from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';

interface Suggestion {
  from: number;
  text: string;
}

export interface EditorOptions {
  onChange: () => void;
  requestSuggestion: (req: {
    textBefore: string;
    textAfter: string;
    signal: AbortSignal;
  }) => Promise<string>;
  /** 切页期间为 true，用于抑制 setState 触发的虚假 onChange / 补全请求 */
  isSwitching: () => boolean;
}

export interface EditorHandle {
  view: EditorView;
  /** 用与当前编辑器相同的扩展集创建新文档状态（打开/清空 tab 用）；readOnly 用于无 tab 时的空态 */
  createState(doc: string, readOnly?: boolean): EditorState;
  /** 取消挂起的幽灵补全并清除已显示的幽灵文本（切页/关页前调用） */
  cancelSuggestion(): void;
  destroy(): void;
}

const setGhostEffect = StateEffect.define<Suggestion | null>();
const noReschedule = Annotation.define<boolean>();

const IDLE_DELAY = 800;
const SENTENCE_END = /[。！？…”»]/;
const BOUNDARY = /[\s，。！？、；：…—""''（）【】]/;

const ghostField = StateField.define<Suggestion | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setGhostEffect)) return e.value;
    }
    if (tr.docChanged) return null;
    if (tr.selection && value && tr.state.selection.main.head !== value.from) return null;
    return value;
  },
});

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: GhostWidget): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-ghost';
    span.textContent = this.text;
    return span;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

const showGhost = StateField.define<RangeSet<Decoration>>({
  create: () => Decoration.none,
  update(_deco, tr) {
    const s = tr.state.field(ghostField, false);
    if (!s) return Decoration.none;
    const widget = Decoration.widget({ widget: new GhostWidget(s.text), side: 1 });
    return Decoration.set([widget.range(s.from)]);
  },
  provide: (f) => EditorView.decorations.from(f),
});

function nextBoundary(text: string): number {
  const m = BOUNDARY.exec(text);
  return m ? m.index : -1;
}

class GhostPlugin {
  private timer: number | undefined;
  private controller: AbortController | null = null;
  private dismissals = 0;
  private cooldownUntil = 0;

  constructor(
    private view: EditorView,
    private opts: EditorOptions,
  ) {}

  update(update: ViewUpdate): void {
    if (!update.docChanged) return;
    if (this.opts.isSwitching()) return;
    if (update.transactions.some((tr) => tr.annotation(noReschedule))) {
      this.dismissals = 0;
      return;
    }
    if (update.startState.field(ghostField)) {
      this.dismissals += 1;
      if (this.dismissals >= 2) {
        this.cooldownUntil = Date.now() + 30_000;
        this.dismissals = 0;
      }
    }
    this.schedule(update.view);
  }

  destroy(): void {
    window.clearTimeout(this.timer);
    this.controller?.abort();
  }

  cancelPending(): void {
    window.clearTimeout(this.timer);
    this.controller?.abort();
  }

  private schedule(view: EditorView): void {
    window.clearTimeout(this.timer);
    const head = view.state.selection.main.head;
    const lastChar = head > 0 ? view.state.sliceDoc(head - 1, head) : '';
    const delay = SENTENCE_END.test(lastChar) ? 0 : IDLE_DELAY;
    this.timer = window.setTimeout(() => void this.request(), delay);
  }

  private async request(): Promise<void> {
    if (this.cooldownUntil > Date.now()) return;
    if (this.controller) this.controller.abort();
    const controller = new AbortController();
    this.controller = controller;

    const head = this.view.state.selection.main.head;
    const textBefore = this.view.state.sliceDoc(Math.max(0, head - 2000), head);
    const textAfter = this.view.state.sliceDoc(head, head + 500);
    try {
      const text = await this.opts.requestSuggestion({
        textBefore,
        textAfter,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (this.cooldownUntil > Date.now()) return;
      if (this.view.state.selection.main.head !== head) return;
      const clean = text.trim();
      if (!clean) return;
      this.view.dispatch({ effects: setGhostEffect.of({ from: head, text: clean }) });
      this.dismissals = 0;
    } catch {
      // 被中断或请求失败：静默忽略
    }
  }
}

function acceptAll(view: EditorView): boolean {
  const s = view.state.field(ghostField);
  if (!s) return false;
  view.dispatch({
    changes: { from: s.from, insert: s.text },
    selection: { anchor: s.from + s.text.length },
    effects: setGhostEffect.of(null),
    annotations: noReschedule.of(true),
  });
  return true;
}

function acceptNextWord(view: EditorView): boolean {
  const s = view.state.field(ghostField);
  if (!s) return false;
  let take: string;
  const b = nextBoundary(s.text);
  if (b > 0) take = s.text.slice(0, b);
  else take = s.text.slice(0, 1);
  const rest = s.text.slice(take.length);
  view.dispatch({
    changes: { from: s.from, insert: take },
    selection: { anchor: s.from + take.length },
    effects: setGhostEffect.of(rest ? { from: s.from + take.length, text: rest } : null),
    annotations: noReschedule.of(true),
  });
  return true;
}

function dismiss(view: EditorView): boolean {
  const s = view.state.field(ghostField);
  if (!s) return false;
  view.dispatch({ effects: setGhostEffect.of(null), annotations: noReschedule.of(true) });
  return true;
}

export function createEditor(
  parent: HTMLElement,
  doc: string,
  opts: EditorOptions,
  readOnly = false,
): EditorHandle {
  const pluginSpec = ViewPlugin.fromClass(
    class extends GhostPlugin {
      constructor(view: EditorView) {
        super(view, opts);
      }
    },
  );

  const extensions: Extension[] = [
    lineNumbers(),
    drawSelection(),
    highlightActiveLine(),
    history(),
    markdown(),
    syntaxHighlighting(defaultHighlightStyle),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    ghostField,
    showGhost,
    pluginSpec,
    Prec.high(
      keymap.of([
        { key: 'Tab', run: acceptAll, preventDefault: true },
        { key: 'ArrowRight', run: acceptNextWord },
        { key: 'Escape', run: dismiss },
      ]),
    ),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !opts.isSwitching()) opts.onChange();
    }),
    EditorView.theme({
      '&': {
        backgroundColor: 'transparent',
        fontSize: '16px',
        height: '100%',
      },
      '.cm-content': {
        fontFamily: '"Source Han Serif SC", "Noto Serif CJK SC", "SimSun", serif',
        lineHeight: '1.9',
        maxWidth: '720px',
        padding: '24px 32px 40vh',
      },
      '.cm-line': {
        padding: '0 4px',
      },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        borderRight: 'none',
        color: 'var(--muted)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
      },
    }),
  ];

  const state = EditorState.create({
    doc,
    extensions: readOnly ? [...extensions, EditorState.readOnly.of(true)] : extensions,
  });
  const view = new EditorView({ parent, state });

  return {
    view,
    createState: (d, readOnly = false) =>
      EditorState.create({
        doc: d,
        extensions: readOnly ? [...extensions, EditorState.readOnly.of(true)] : extensions,
      }),
    cancelSuggestion: () => {
      view.plugin(pluginSpec)?.cancelPending();
      if (view.state.field(ghostField, false)) {
        view.dispatch({ effects: setGhostEffect.of(null), annotations: noReschedule.of(true) });
      }
    },
    destroy: () => view.destroy(),
  };
}
