import { app } from '../app';
import { api, type Character, type CharacterInput } from '../api';
import { el, val, field, actionBtn } from '../ui';
import { createCrudView } from './crud';

export const charactersView = createCrudView<Character>({
  id: 'characters',
  label: '人物卡',
  headerTitle: '新建人物',
  emptyHint: '还没有人物卡。建立人物卡后，续写时 AI 会严格遵循设定，防吃书。',
  fetch: (novelId) => api.characters(novelId),
  remove: (id) => api.deleteCharacter(id),
  item: (ch, actions) => {
    const info = el('div', 'view-item-info');
    info.appendChild(el('div', 'view-item-title', ch.name + (ch.status ? `（${ch.status}）` : '')));
    const details = [ch.profile, ch.speaking_style ? `口癖：${ch.speaking_style}` : '']
      .filter(Boolean)
      .join(' / ');
    info.appendChild(el('div', 'view-item-body', details || '—'));
    const actionsEl = el('div', 'view-item-actions');
    actionsEl.appendChild(actionBtn('编辑', false, actions.edit));
    actionsEl.appendChild(actionBtn('删除', true, actions.remove));
    const itemEl = el('div', 'view-item');
    itemEl.append(info, actionsEl);
    return itemEl;
  },
  form: (edit, hooks) => {
    const form = el('div', 'view-form');
    form.append(
      field('char-name', '姓名 *', edit?.name ?? '', { placeholder: '林晚' }),
      field('char-profile', '身份/背景', edit?.profile ?? '', {
        textarea: true,
        rows: 2,
        placeholder: '前游泳队队员，右手虎口有茧…',
      }),
      field('char-speak', '口癖/说话习惯', edit?.speaking_style ?? '', { placeholder: '话少，短句' }),
      field('char-status', '当前状态', edit?.status ?? '', { placeholder: '深夜值班' }),
    );
    const row = el('div', 'view-form-row');
    row.appendChild(actionBtn(edit ? '保存修改' : '添加人物', false, () => void hooks.commit()));
    if (edit) row.appendChild(actionBtn('取消', false, hooks.back));
    form.appendChild(row);
    return form;
  },
  save: async (edit) => {
    const novelId = app.currentNovel?.id;
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
    if (edit) await api.updateCharacter(edit.id, data);
    else await api.createCharacter(data);
  },
});
