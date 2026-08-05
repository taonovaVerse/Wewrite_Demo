import {
  api,
  type Character,
  type CharacterInput,
  type WorldSetting,
  type WorldSettingInput,
  type Foreshadowing,
  type ForeshadowingInput,
  type StyleProfile,
} from './api';

export interface ManageCtx {
  novelId(): number | null;
  chapterId(): number | null;
  blueprint(): string;
  saveBlueprint(text: string): Promise<void>;
}

type TabId = 'characters' | 'world' | 'foreshadow' | 'style' | 'blueprint';

let ctx: ManageCtx | null = null;
let currentTab: TabId = 'characters';

function modal(): HTMLElement {
  return document.getElementById('manage-modal')!;
}

function body(): HTMLElement {
  return document.getElementById('manage-body')!;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function val(id: string): string {
  const node = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  return node?.value.trim() ?? '';
}

function field(
  id: string,
  label: string,
  value: string,
  opts?: { textarea?: boolean; placeholder?: string; rows?: number },
): HTMLElement {
  const wrap = el('div', 'manage-field');
  const lab = el('label', '', label);
  lab.setAttribute('for', id);
  const input = opts?.textarea ? document.createElement('textarea') : document.createElement('input');
  input.id = id;
  input.className = 'input' + (opts?.textarea ? ' manage-textarea' : '');
  if (opts?.textarea) {
    (input as HTMLTextAreaElement).rows = opts.rows ?? 3;
  } else if (opts?.placeholder) {
    (input as HTMLInputElement).placeholder = opts.placeholder;
  }
  input.value = value;
  wrap.append(lab, input);
  return wrap;
}

function actionBtn(label: string, danger: boolean, onClick: () => void): HTMLElement {
  const btn = el('button', 'btn' + (danger ? ' btn-danger' : ''), label);
  btn.addEventListener('click', onClick);
  return btn;
}

// ---------- 打开/关闭 ----------

export function openManagePanel(c: ManageCtx): void {
  ctx = c;
  if (!ctx.novelId()) return;
  modal().classList.remove('hidden');
  void switchTab('characters');
}

function closeManagePanel(): void {
  modal().classList.add('hidden');
}

function switchTab(tab: TabId): Promise<void> {
  currentTab = tab;
  modal().querySelectorAll('.manage-tab').forEach((node) => {
    (node as HTMLElement).classList.toggle('active', node.getAttribute('data-tab') === tab);
  });
  body().innerHTML = '';
  if (tab === 'characters') return renderCharacters();
  if (tab === 'world') return renderWorld();
  if (tab === 'foreshadow') return renderForeshadow();
  if (tab === 'style') return renderStyle();
  return renderBlueprint();
}

export function setupManageUI(c: ManageCtx): void {
  ctx = c;
  document.getElementById('manage-close-btn')!.addEventListener('click', closeManagePanel);
  modal().querySelectorAll('.manage-tab').forEach((node) => {
    node.addEventListener('click', () => void switchTab(node.getAttribute('data-tab') as TabId));
  });
}

// ---------- 人物 ----------

async function renderCharacters(): Promise<void> {
  const novelId = ctx!.novelId();
  const list = novelId ? await api.characters(novelId) : [];
  const wrap = el('div', 'manage-section');
  const listEl = el('div', 'manage-list');
  if (list.length === 0) {
    listEl.appendChild(el('div', 'manage-hint', '还没有人物卡。建立人物卡后，续写时 AI 会严格遵循设定，防吃书。'));
  }
  for (const c of list) {
    const info = el('div', 'manage-item-info');
    info.appendChild(el('div', 'manage-item-title', c.name + (c.status ? `（${c.status}）` : '')));
    const details = [c.profile, c.speaking_style ? `口癖：${c.speaking_style}` : '']
      .filter(Boolean)
      .join(' / ');
    info.appendChild(el('div', 'manage-item-body', details || '—'));
    const actions = el('div', 'manage-item-actions');
    actions.appendChild(actionBtn('编辑', false, () => void renderCharForm(c)));
    actions.appendChild(
      actionBtn('删除', true, () => {
        void api.deleteCharacter(c.id).then(() => renderCharacters());
      }),
    );
    const item = el('div', 'manage-item');
    item.append(info, actions);
    listEl.appendChild(item);
  }
  wrap.append(listEl, await charForm(null));
  body().appendChild(wrap);
}

async function charForm(edit: Character | null): Promise<HTMLElement> {
  const form = el('div', 'manage-form');
  form.append(
    field('char-name', '姓名 *', edit?.name ?? '', { placeholder: '林晚' }),
    field('char-profile', '身份/背景', edit?.profile ?? '', { textarea: true, rows: 2, placeholder: '前游泳队队员，右手虎口有茧…' }),
    field('char-speak', '口癖/说话习惯', edit?.speaking_style ?? '', { placeholder: '话少，短句' }),
    field('char-status', '当前状态', edit?.status ?? '', { placeholder: '深夜值班' }),
  );
  const row = el('div', 'manage-form-row');
  row.appendChild(
    actionBtn(edit ? '保存修改' : '添加人物', false, () => {
      void saveChar(edit);
    }),
  );
  if (edit) {
    row.appendChild(actionBtn('取消', false, () => void renderCharacters()));
  }
  form.appendChild(row);
  return form;
}

async function saveChar(edit: Character | null): Promise<void> {
  const novelId = ctx!.novelId();
  if (!novelId) return;
  const name = val('char-name');
  if (!name) return;
  const data: CharacterInput = {
    novelId,
    name,
    profile: val('char-profile'),
    speakingStyle: val('char-speak'),
    status: val('char-status'),
  };
  if (edit) {
    await api.updateCharacter(edit.id, data);
  } else {
    await api.createCharacter(data);
  }
  await renderCharacters();
}

function renderCharForm(edit: Character): Promise<void> {
  body().innerHTML = '';
  const wrap = el('div', 'manage-section');
  return charForm(edit).then((form) => {
    wrap.appendChild(form);
    body().appendChild(wrap);
  });
}

// ---------- 世界观 ----------

async function renderWorld(): Promise<void> {
  const novelId = ctx!.novelId();
  const list = novelId ? await api.worldSettings(novelId) : [];
  const wrap = el('div', 'manage-section');
  const listEl = el('div', 'manage-list');
  if (list.length === 0) {
    listEl.appendChild(el('div', 'manage-hint', '还没有世界观设定。写清地理、年代、社会规则等，续写时 AI 不会跑偏。'));
  }
  for (const s of list) {
    const info = el('div', 'manage-item-info');
    info.appendChild(el('div', 'manage-item-title', s.key));
    info.appendChild(el('div', 'manage-item-body', s.value || '—'));
    const actions = el('div', 'manage-item-actions');
    actions.appendChild(actionBtn('编辑', false, () => void renderWorldForm(s)));
    actions.appendChild(
      actionBtn('删除', true, () => {
        void api.deleteWorldSetting(s.id).then(() => renderWorld());
      }),
    );
    const item = el('div', 'manage-item');
    item.append(info, actions);
    listEl.appendChild(item);
  }
  wrap.append(listEl, worldForm(null));
  body().appendChild(wrap);
}

function worldForm(edit: WorldSetting | null): HTMLElement {
  const form = el('div', 'manage-form');
  form.append(
    field('ws-key', '设定名 *', edit?.key ?? '', { placeholder: '城市' }),
    field('ws-value', '设定内容', edit?.value ?? '', { placeholder: '沿海三线小城，常年多雨' }),
  );
  const row = el('div', 'manage-form-row');
  row.appendChild(
    actionBtn(edit ? '保存修改' : '添加设定', false, () => {
      void saveWorld(edit);
    }),
  );
  if (edit) {
    row.appendChild(actionBtn('取消', false, () => void renderWorld()));
  }
  form.appendChild(row);
  return form;
}

async function saveWorld(edit: WorldSetting | null): Promise<void> {
  const novelId = ctx!.novelId();
  if (!novelId) return;
  const key = val('ws-key');
  if (!key) return;
  const data: WorldSettingInput = { novelId, key, value: val('ws-value') };
  if (edit) {
    await api.updateWorldSetting(edit.id, data);
  } else {
    await api.createWorldSetting(data);
  }
  await renderWorld();
}

function renderWorldForm(edit: WorldSetting): Promise<void> {
  body().innerHTML = '';
  const wrap = el('div', 'manage-section');
  wrap.appendChild(worldForm(edit));
  body().appendChild(wrap);
  return Promise.resolve();
}

// ---------- 伏笔 ----------

async function renderForeshadow(): Promise<void> {
  const novelId = ctx!.novelId();
  const list = novelId ? await api.foreshadowing(novelId) : [];
  const wrap = el('div', 'manage-section');
  const listEl = el('div', 'manage-list');
  if (list.length === 0) {
    listEl.appendChild(el('div', 'manage-hint', '还没有伏笔。登记后，续写时 AI 会记得埋下的线索；resolve 后从上下文消失。'));
  }
  for (const f of list) {
    const info = el('div', 'manage-item-info');
    const metaBits = [];
    if (f.planted_chapter != null) metaBits.push(`埋于 §${f.planted_chapter}`);
    if (f.resolved_chapter != null) metaBits.push(`已解于 §${f.resolved_chapter}`);
    info.appendChild(el('div', 'manage-item-title', metaBits.length ? metaBits.join(' · ') : '伏笔'));
    info.appendChild(el('div', 'manage-item-body', f.note || '—'));
    const actions = el('div', 'manage-item-actions');
    actions.appendChild(actionBtn('编辑', false, () => void renderForeshadowForm(f)));
    actions.appendChild(
      actionBtn('删除', true, () => {
        void api.deleteForeshadowing(f.id).then(() => renderForeshadow());
      }),
    );
    const item = el('div', 'manage-item');
    item.append(info, actions);
    listEl.appendChild(item);
  }
  wrap.append(listEl, foreshadowForm(null));
  body().appendChild(wrap);
}

function foreshadowForm(edit: Foreshadowing | null): HTMLElement {
  const form = el('div', 'manage-form');
  form.append(
    field('fs-note', '伏笔内容 *', edit?.note ?? '', { textarea: true, rows: 2, placeholder: '她虎口的茧来自常年握游泳板…' }),
  );
  const row = el('div', 'manage-form-row');
  row.appendChild(
    field('fs-planted', '埋于章节', edit?.planted_chapter != null ? String(edit.planted_chapter) : '', { placeholder: '1' }),
  );
  row.appendChild(
    field('fs-resolved', '解于章节（留空=未解）', edit?.resolved_chapter != null ? String(edit.resolved_chapter) : '', { placeholder: '空' }),
  );
  const saveRow = el('div', 'manage-form-row');
  saveRow.appendChild(
    actionBtn(edit ? '保存修改' : '添加伏笔', false, () => {
      void saveForeshadow(edit);
    }),
  );
  if (edit) {
    saveRow.appendChild(actionBtn('取消', false, () => void renderForeshadow()));
  }
  form.append(row, saveRow);
  return form;
}

async function saveForeshadow(edit: Foreshadowing | null): Promise<void> {
  const novelId = ctx!.novelId();
  if (!novelId) return;
  const note = val('fs-note');
  if (!note) return;
  const planted = parseNum(val('fs-planted'));
  const resolved = parseNum(val('fs-resolved'));
  const data: ForeshadowingInput = { novelId, note, plantedChapter: planted, resolvedChapter: resolved };
  if (edit) {
    await api.updateForeshadowing(edit.id, data);
  } else {
    await api.createForeshadowing(data);
  }
  await renderForeshadow();
}

function parseNum(s: string): number | null {
  const n = Number(s);
  return Number.isFinite(n) && s !== '' ? n : null;
}

function renderForeshadowForm(edit: Foreshadowing): Promise<void> {
  body().innerHTML = '';
  const wrap = el('div', 'manage-section');
  wrap.appendChild(foreshadowForm(edit));
  body().appendChild(wrap);
  return Promise.resolve();
}

// ---------- 文风 ----------

async function renderStyle(): Promise<void> {
  const novelId = ctx!.novelId();
  const sp: StyleProfile | null = novelId ? await api.styleProfile(novelId) : null;
  const wrap = el('div', 'manage-section');
  const hint = el('div', 'manage-hint', '文风档案进入续写/补全的稳定前缀。taboo_words 留空时用内置默认禁用词表。');
  const form = el('div', 'manage-form');
  form.append(
    field('style-voice', '叙述口吻', sp?.voice ?? '', { textarea: true, rows: 2, placeholder: '冷峻克制，白描为主…' }),
    field('style-rhythm', '节奏说明', sp?.rhythm_notes ?? '', { textarea: true, rows: 2, placeholder: '短句多，少长从句…' }),
    field('style-taboo', '禁用词（逗号分隔，AI腔）', sp?.taboo_words ?? '', { textarea: true, rows: 2, placeholder: '氛围感、治愈、仿佛…' }),
  );
  const row = el('div', 'manage-form-row');
  const saveBtn = actionBtn('保存文风', false, () => {
    void saveStyle(saveBtn);
  });
  row.appendChild(saveBtn);
  form.appendChild(row);
  wrap.append(hint, form);
  body().appendChild(wrap);
}

async function saveStyle(btn: HTMLElement): Promise<void> {
  const novelId = ctx!.novelId();
  if (!novelId) return;
  await api.saveStyleProfile({
    novelId,
    voice: val('style-voice'),
    rhythmNotes: val('style-rhythm'),
    tabooWords: val('style-taboo'),
  });
  btn.textContent = '已保存 ✓';
  setTimeout(() => {
    btn.textContent = '保存文风';
  }, 1200);
}

// ---------- 细纲 ----------

async function renderBlueprint(): Promise<void> {
  const wrap = el('div', 'manage-section');
  const hint = el('div', 'manage-hint', '章节细纲（蓝图）是续写时 AI 必须遵循的走向，属于当前章节。留空则 AI 只能依据已写正文推断，防吃书能力减弱。');
  const ta = document.createElement('textarea');
  ta.id = 'blueprint-text';
  ta.className = 'input manage-textarea';
  ta.rows = 12;
  ta.value = ctx!.blueprint();
  const row = el('div', 'manage-form-row');
  const saveBtn = actionBtn('保存细纲', false, () => {
    void saveBlueprint(ta, saveBtn);
  });
  row.appendChild(saveBtn);
  wrap.append(hint, ta, row);
  body().appendChild(wrap);
}

async function saveBlueprint(ta: HTMLTextAreaElement, btn: HTMLElement): Promise<void> {
  await ctx!.saveBlueprint(ta.value);
  btn.textContent = '已保存 ✓';
  setTimeout(() => {
    btn.textContent = '保存细纲';
  }, 1200);
}
