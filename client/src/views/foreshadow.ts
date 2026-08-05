import { app } from '../app';
import { api, type Foreshadowing, type ForeshadowingInput } from '../api';
import { el, val, field, actionBtn } from '../ui';
import { createCrudView } from './crud';

function parseNum(s: string): number | null {
  const n = Number(s);
  return Number.isFinite(n) && s !== '' ? n : null;
}

export const foreshadowView = createCrudView<Foreshadowing>({
  id: 'foreshadow',
  label: '伏笔',
  headerTitle: '新建伏笔',
  emptyHint: '还没有伏笔。登记后，续写时 AI 会记得埋下的线索。',
  fetch: (novelId) => api.foreshadowing(novelId),
  remove: (id) => api.deleteForeshadowing(id),
  item: (f, actions) => {
    const info = el('div', 'view-item-info');
    const metaBits = [];
    if (f.planted_chapter != null) metaBits.push(`埋于 §${f.planted_chapter}`);
    if (f.resolved_chapter != null) metaBits.push(`已解于 §${f.resolved_chapter}`);
    info.appendChild(el('div', 'view-item-title', metaBits.length ? metaBits.join(' · ') : '伏笔'));
    info.appendChild(el('div', 'view-item-body', f.note || '—'));
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
      field('fs-note', '伏笔内容 *', edit?.note ?? '', {
        textarea: true,
        rows: 2,
        placeholder: '她虎口的茧来自常年握游泳板…',
      }),
    );
    const row = el('div', 'view-form-row');
    row.appendChild(
      field('fs-planted', '埋于章节', edit?.planted_chapter != null ? String(edit.planted_chapter) : '', {
        placeholder: '1',
      }),
    );
    row.appendChild(
      field(
        'fs-resolved',
        '解于章节（留空=未解）',
        edit?.resolved_chapter != null ? String(edit.resolved_chapter) : '',
        { placeholder: '空' },
      ),
    );
    const saveRow = el('div', 'view-form-row');
    saveRow.appendChild(actionBtn(edit ? '保存修改' : '添加伏笔', false, () => void hooks.commit()));
    if (edit) saveRow.appendChild(actionBtn('取消', false, hooks.back));
    form.append(row, saveRow);
    return form;
  },
  save: async (edit) => {
    const novelId = app.currentNovel?.id;
    if (!novelId) return;
    const note = val('fs-note');
    if (!note) return;
    const data: ForeshadowingInput = {
      novelId,
      note,
      plantedChapter: parseNum(val('fs-planted')),
      resolvedChapter: parseNum(val('fs-resolved')),
    };
    if (edit) await api.updateForeshadowing(edit.id, data);
    else await api.createForeshadowing(data);
  },
});
