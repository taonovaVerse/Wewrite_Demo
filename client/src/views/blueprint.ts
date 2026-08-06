import { forceLinting } from '@codemirror/lint';
import { app, activeChapter, patchChapter } from '../app';
import { api, type Character } from '../api';
import { el, field, val, actionBtn, flashSaved } from '../ui';
import type { SidebarView } from './types';

function parseCharIds(sceneCharacters: string): Set<number> {
  const ids = new Set<number>();
  for (const part of sceneCharacters.split(',')) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n > 0) ids.add(n);
  }
  return ids;
}

function charChips(chars: Character[], selected: Set<number>): HTMLElement {
  const wrap = el('div', 'view-field');
  wrap.appendChild(el('label', '', '在场人物'));
  if (chars.length === 0) {
    wrap.appendChild(el('div', 'view-hint', '还没有人物卡。先在「人物卡」视图建立人物，才能勾选。'));
    return wrap;
  }
  const list = el('div', 'scene-chars');
  for (const ch of chars) {
    const label = el('label', 'scene-char');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = String(ch.id);
    cb.checked = selected.has(ch.id);
    label.append(cb, el('span', 'scene-char-name', ch.name));
    list.appendChild(label);
  }
  wrap.appendChild(list);
  return wrap;
}

function collectSceneCharacters(): string[] {
  const ids: string[] = [];
  document.querySelectorAll('.scene-char input[type="checkbox"]:checked').forEach((node) => {
    const v = (node as HTMLInputElement).value;
    if (v) ids.push(v);
  });
  return ids;
}

async function render(c: HTMLElement): Promise<void> {
  c.innerHTML = '';
  const chapter = activeChapter();
  const wrap = el('div', 'view-section');
  if (!chapter) {
    wrap.appendChild(
      el('div', 'view-hint', '打开一个章节后，可在这里写该章的场景信息与细纲（蓝图），续写时 AI 会遵循。'),
    );
    c.appendChild(wrap);
    return;
  }
  const hint = el(
    'div',
    'view-hint',
    `当前章节：${chapter.title || `第 ${chapter.order_idx} 章`}。场景信息让续写聚焦本场景，细纲是 AI 必须遵循的走向。`,
  );

  let chars: Character[] = [];
  try {
    chars = await api.characters(chapter.novel_id);
  } catch {
    // 人物卡加载失败不阻断细纲视图：场景字段照常渲染，人物勾选留空
  }
  const selected = parseCharIds(chapter.scene_characters);
  const sceneSection = el('div', 'view-scene');
  sceneSection.append(
    field('scene-location', '地点', chapter.location, { placeholder: '青州·驿馆' }),
    field('scene-time', '时间段', chapter.time_frame, { placeholder: '夜晚' }),
    field('scene-emotion', '情绪', chapter.emotion, { placeholder: '压抑' }),
    field('scene-theme', '主题', chapter.theme, { placeholder: '火焰 / 执念' }),
    charChips(chars, selected),
  );

  const ta = document.createElement('textarea');
  ta.id = 'blueprint-text';
  ta.className = 'input view-textarea';
  ta.rows = 12;
  ta.value = chapter.blueprint;
  const row = el('div', 'view-form-row');
  const saveBtn = actionBtn('保存细纲', false, () => void saveBlueprint(saveBtn));
  row.appendChild(saveBtn);
  wrap.append(hint, sceneSection, ta, row);
  c.appendChild(wrap);
}

async function saveBlueprint(btn: HTMLElement): Promise<void> {
  const chapter = activeChapter();
  if (!chapter) return;
  const updated = await api.saveChapter(chapter.id, {
    blueprint: val('blueprint-text'),
    location: val('scene-location'),
    timeFrame: val('scene-time'),
    emotion: val('scene-emotion'),
    theme: val('scene-theme'),
    sceneCharacters: collectSceneCharacters(),
  });
  patchChapter(updated);
  // 场景字段变了，SLS 的「场景人物」上下文随之变化；文档没改，需手动触发一次重检
  if (app.editor) forceLinting(app.editor.view);
  flashSaved(btn, '保存细纲');
}

export const blueprintView: SidebarView = {
  id: 'blueprint',
  label: '章节细纲',
  headerTitle: '编辑当前章节场景与细纲',
  render,
  headerButton: () => void render(document.getElementById('sidebar-body')!),
};
