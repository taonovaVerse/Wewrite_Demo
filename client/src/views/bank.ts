import { app } from '../app';
import { api, type DetailBankEntry, type DetailBankInput } from '../api';
import { el, val, field, actionBtn, focusFirstInput } from '../ui';
import type { SidebarView } from './types';

let container: HTMLElement | null = null;
let query = '';
let searchTimer: number | undefined;
let focusAdd: (() => void) | null = null;

async function render(c: HTMLElement): Promise<void> {
  container = c;
  c.innerHTML = '';
  const novelId = app.currentNovel?.id;
  const wrap = el('div', 'view-section');
  if (!novelId) {
    wrap.appendChild(el('div', 'view-hint', '先在资源管理器中选择一部小说。'));
    c.appendChild(wrap);
    return;
  }
  const search = document.createElement('input');
  search.className = 'input';
  search.placeholder = '搜索素材（场景/标签/内容）…';
  search.value = query;
  search.addEventListener('input', (e) => {
    query = (e.target as HTMLInputElement).value.trim();
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void renderList(), 300);
  });
  const listEl = el('div', 'view-list');
  listEl.id = 'bank-list';
  const form = bankForm(null);
  wrap.append(search, listEl, form);
  c.appendChild(wrap);
  focusAdd = () => focusFirstInput(form);
  await renderList();
}

async function renderList(): Promise<void> {
  const listEl = document.getElementById('bank-list');
  if (!listEl) return;
  const novelId = app.currentNovel?.id;
  if (!novelId) return;
  listEl.innerHTML = '';
  let entries: DetailBankEntry[] = [];
  try {
    entries = await api.detailBank.list(novelId, query);
  } catch {
    entries = [];
  }
  if (entries.length === 0) {
    listEl.appendChild(
      el(
        'div',
        'view-hint',
        query
          ? '没有匹配的素材。'
          : '素材库为空。写下你观察到的生活细节，生成细节时 AI 会引用它们。',
      ),
    );
    return;
  }
  for (const entry of entries) listEl.appendChild(item(entry));
}

function item(entry: DetailBankEntry): HTMLElement {
  const info = el('div', 'view-item-info');
  const meta = [entry.scene_type, entry.sensory_channel, entry.tags].filter(Boolean).join(' · ');
  info.appendChild(el('div', 'view-item-title', meta || '未分类'));
  info.appendChild(el('div', 'view-item-body', entry.content));
  const actions = el('div', 'view-item-actions');
  actions.appendChild(actionBtn('编辑', false, () => void renderForm(entry)));
  actions.appendChild(
    actionBtn('删除', true, () => void api.detailBank.remove(entry.id).then(() => renderList())),
  );
  const itemEl = el('div', 'view-item');
  itemEl.append(info, actions);
  return itemEl;
}

function bankForm(edit: DetailBankEntry | null): HTMLElement {
  const form = el('div', 'view-form');
  form.append(
    field('bank-scene', '场景类型', edit?.scene_type ?? '', { placeholder: '深夜便利店' }),
    field('bank-channel', '感官通道', edit?.sensory_channel ?? '', { placeholder: '视觉/听觉/触觉' }),
    field('bank-content', '素材内容', edit?.content ?? '', {
      textarea: true,
      rows: 3,
      placeholder: '你观察到的真实生活细节…',
    }),
    field('bank-tags', '标签（逗号分隔）', edit?.tags ?? '', { placeholder: '雨夜,便利店,关东煮' }),
  );
  const row = el('div', 'view-form-row');
  row.appendChild(actionBtn(edit ? '保存修改' : '保存素材', false, () => void saveBank(edit)));
  if (edit) row.appendChild(actionBtn('取消', false, () => void render(container!)));
  form.appendChild(row);
  return form;
}

async function saveBank(edit: DetailBankEntry | null): Promise<void> {
  const novelId = app.currentNovel?.id;
  if (!novelId) return;
  const content = val('bank-content');
  if (!content) return;
  const data: DetailBankInput = {
    novelId,
    sceneType: val('bank-scene'),
    sensoryChannel: val('bank-channel'),
    content,
    tags: val('bank-tags'),
  };
  if (edit) await api.detailBank.update(edit.id, data);
  else await api.detailBank.create(data);
  query = '';
  await render(container!);
}

function renderForm(edit: DetailBankEntry): Promise<void> {
  const c = container!;
  c.innerHTML = '';
  const wrap = el('div', 'view-section');
  const back = actionBtn('← 返回列表', false, () => void render(c));
  back.className += ' view-back';
  wrap.append(back, bankForm(edit));
  c.appendChild(wrap);
  return Promise.resolve();
}

export const bankView: SidebarView = {
  id: 'bank',
  label: '素材库',
  headerTitle: '新建素材',
  render,
  headerButton: () => void render(container!).then(() => focusAdd?.()),
};
