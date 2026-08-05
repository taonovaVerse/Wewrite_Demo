import { app } from '../app';
import { api, type StyleProfile } from '../api';
import { el, val, field, actionBtn, flashSaved } from '../ui';
import type { SidebarView } from './types';

async function render(c: HTMLElement): Promise<void> {
  c.innerHTML = '';
  const novelId = app.currentNovel?.id;
  const wrap = el('div', 'view-section');
  if (!novelId) {
    wrap.appendChild(el('div', 'view-hint', '先在资源管理器中选择一部小说。'));
    c.appendChild(wrap);
    return;
  }
  const sp: StyleProfile | null = await api.styleProfile(novelId);
  const hint = el(
    'div',
    'view-hint',
    '文风档案进入续写/补全的稳定前缀。taboo_words 留空时用内置默认禁用词表。',
  );
  const form = el('div', 'view-form');
  form.append(
    field('style-voice', '叙述口吻', sp?.voice ?? '', {
      textarea: true,
      rows: 2,
      placeholder: '冷峻克制，白描为主…',
    }),
    field('style-rhythm', '节奏说明', sp?.rhythm_notes ?? '', {
      textarea: true,
      rows: 2,
      placeholder: '短句多，少长从句…',
    }),
    field('style-taboo', '禁用词（逗号分隔，AI腔）', sp?.taboo_words ?? '', {
      textarea: true,
      rows: 2,
      placeholder: '氛围感、治愈、仿佛…',
    }),
  );
  const row = el('div', 'view-form-row');
  const saveBtn = actionBtn('保存文风', false, () => void saveStyle(saveBtn));
  row.appendChild(saveBtn);
  form.appendChild(row);
  wrap.append(hint, form);
  c.appendChild(wrap);
}

async function saveStyle(btn: HTMLElement): Promise<void> {
  const novelId = app.currentNovel?.id;
  if (!novelId) return;
  await api.saveStyleProfile({
    novelId,
    voice: val('style-voice'),
    rhythmNotes: val('style-rhythm'),
    tabooWords: val('style-taboo'),
  });
  flashSaved(btn, '保存文风');
}

export const styleView: SidebarView = {
  id: 'style',
  label: '文风',
  headerTitle: '编辑文风档案',
  render,
  headerButton: () => void render(document.getElementById('sidebar-body')!),
};
