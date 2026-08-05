import { app, activeChapter, patchChapter } from '../app';
import { api } from '../api';
import { el, actionBtn, flashSaved } from '../ui';
import type { SidebarView } from './types';

async function render(c: HTMLElement): Promise<void> {
  c.innerHTML = '';
  const chapter = activeChapter();
  const wrap = el('div', 'view-section');
  if (!chapter) {
    wrap.appendChild(
      el('div', 'view-hint', '打开一个章节后，可在这里写该章的细纲（蓝图），续写时 AI 会遵循。'),
    );
    c.appendChild(wrap);
    return;
  }
  const hint = el(
    'div',
    'view-hint',
    `当前章节：${chapter.title || `第 ${chapter.order_idx} 章`}。细纲是续写时 AI 必须遵循的走向。`,
  );
  const ta = document.createElement('textarea');
  ta.id = 'blueprint-text';
  ta.className = 'input view-textarea';
  ta.rows = 12;
  ta.value = chapter.blueprint;
  const row = el('div', 'view-form-row');
  const saveBtn = actionBtn('保存细纲', false, () => void saveBlueprint(ta, saveBtn));
  row.appendChild(saveBtn);
  wrap.append(hint, ta, row);
  c.appendChild(wrap);
}

async function saveBlueprint(ta: HTMLTextAreaElement, btn: HTMLElement): Promise<void> {
  const chapter = activeChapter();
  if (!chapter) return;
  const updated = await api.saveChapter(chapter.id, { blueprint: ta.value });
  patchChapter(updated);
  flashSaved(btn, '保存细纲');
}

export const blueprintView: SidebarView = {
  id: 'blueprint',
  label: '章节细纲',
  headerTitle: '编辑当前章节细纲',
  render,
  headerButton: () => void render(document.getElementById('sidebar-body')!),
};
