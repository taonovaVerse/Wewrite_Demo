import { app } from '../app';
import { el, actionBtn, focusFirstInput } from '../ui';
import type { ViewId, SidebarView } from './types';

export interface CrudHooks {
  /** 保存当前表单值并刷新列表 */
  commit(): Promise<void>;
  /** 离开编辑模式，回到列表 */
  back(): void;
}

export interface CrudActions {
  edit(): void;
  remove(): void;
}

export interface CrudOptions<T extends { id: number }> {
  id: ViewId;
  label: string;
  headerTitle: string;
  emptyHint: string;
  noNovelHint?: string;
  fetch(novelId: number): Promise<T[]>;
  remove(id: number): Promise<void>;
  item(t: T, actions: CrudActions): HTMLElement;
  form(edit: T | null, hooks: CrudHooks): HTMLElement;
  save(edit: T | null): Promise<void>;
}

let container: HTMLElement | null = null;
let focusAdd: (() => void) | null = null;

export function createCrudView<T extends { id: number }>(opts: CrudOptions<T>): SidebarView {
  const noNovelHint = opts.noNovelHint ?? '先在资源管理器中选择一部小说。';

  async function render(c: HTMLElement): Promise<void> {
    container = c;
    c.innerHTML = '';
    const novelId = app.currentNovel?.id;
    const wrap = el('div', 'view-section');
    if (!novelId) {
      wrap.appendChild(el('div', 'view-hint', noNovelHint));
      c.appendChild(wrap);
      return;
    }
    const list = await opts.fetch(novelId);
    const listEl = el('div', 'view-list');
    if (list.length === 0) listEl.appendChild(el('div', 'view-hint', opts.emptyHint));
    for (const t of list) listEl.appendChild(opts.item(t, actionsFor(t)));
    const form = opts.form(null, hooksFor(null));
    wrap.append(listEl, form);
    c.appendChild(wrap);
    focusAdd = () => focusFirstInput(form);
  }

  function actionsFor(t: T): CrudActions {
    return {
      edit: () => void renderForm(t),
      remove: () => void opts.remove(t.id).then(() => render(container!)),
    };
  }

  function hooksFor(edit: T | null): CrudHooks {
    return {
      commit: async () => {
        await opts.save(edit);
        await render(container!);
      },
      back: () => void render(container!),
    };
  }

  function renderForm(edit: T): void {
    const c = container!;
    c.innerHTML = '';
    const wrap = el('div', 'view-section');
    wrap.appendChild(opts.form(edit, hooksFor(edit)));
    c.appendChild(wrap);
  }

  return {
    id: opts.id,
    label: opts.label,
    headerTitle: opts.headerTitle,
    render,
    headerButton: () => void render(container!).then(() => focusAdd?.()),
  };
}
