import { app } from '../app';
import { api, type WorldSetting, type WorldSettingInput } from '../api';
import { el, val, field, actionBtn } from '../ui';
import { createCrudView } from './crud';

export const worldView = createCrudView<WorldSetting>({
  id: 'world',
  label: '世界观',
  headerTitle: '新建设定',
  emptyHint: '还没有世界观设定。写清地理、年代、社会规则等，续写时 AI 不会跑偏。',
  fetch: (novelId) => api.worldSettings(novelId),
  remove: (id) => api.deleteWorldSetting(id),
  item: (s, actions) => {
    const info = el('div', 'view-item-info');
    info.appendChild(el('div', 'view-item-title', s.key));
    info.appendChild(el('div', 'view-item-body', s.value || '—'));
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
      field('ws-key', '设定名 *', edit?.key ?? '', { placeholder: '城市' }),
      field('ws-value', '设定内容', edit?.value ?? '', { placeholder: '沿海三线小城，常年多雨' }),
    );
    const row = el('div', 'view-form-row');
    row.appendChild(actionBtn(edit ? '保存修改' : '添加设定', false, () => void hooks.commit()));
    if (edit) row.appendChild(actionBtn('取消', false, hooks.back));
    form.appendChild(row);
    return form;
  },
  save: async (edit) => {
    const novelId = app.currentNovel?.id;
    if (!novelId) return;
    const key = val('ws-key');
    if (!key) return;
    const data: WorldSettingInput = { novelId, key, value: val('ws-value') };
    if (edit) await api.updateWorldSetting(edit.id, data);
    else await api.createWorldSetting(data);
  },
});
