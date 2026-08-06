import { explorerView } from './views/explorer';
import { charactersView } from './views/characters';
import { worldView } from './views/world';
import { foreshadowView } from './views/foreshadow';
import { styleView } from './views/style';
import { blueprintView } from './views/blueprint';
import { bankView } from './views/bank';
import { historyView } from './views/history';
import type { ViewId, SidebarView } from './views/types';
import { el } from './ui';

const views: Record<ViewId, SidebarView> = {
  explorer: explorerView,
  characters: charactersView,
  world: worldView,
  foreshadow: foreshadowView,
  style: styleView,
  blueprint: blueprintView,
  bank: bankView,
  history: historyView,
};

const VIEW_TITLES: Record<ViewId, string> = {
  explorer: '资源管理器',
  characters: '人物卡',
  world: '世界观',
  foreshadow: '伏笔',
  style: '文风',
  blueprint: '章节细纲',
  bank: '素材库',
  history: '历史',
};

let active: ViewId = 'explorer';

export function setActiveView(id: ViewId): void {
  active = id;
  document.querySelectorAll('#activitybar .activity-item').forEach((node) => {
    node.classList.toggle('active', node.getAttribute('data-view') === id);
  });
  void render();
}

export async function refresh(): Promise<void> {
  await render();
}

async function render(): Promise<void> {
  const view = views[active];
  const header = document.getElementById('sidebar-header')!;
  header.innerHTML = '';
  header.appendChild(el('span', '', VIEW_TITLES[active]));
  const actions = el('div', 'sidebar-actions');
  const plus = document.createElement('button');
  plus.className = 'sidebar-title-btn';
  plus.title = view.headerTitle;
  plus.textContent = '+';
  plus.addEventListener('click', () => view.headerButton());
  actions.appendChild(plus);
  header.appendChild(actions);

  const body = document.getElementById('sidebar-body')!;
  body.innerHTML = '';
  await view.render(body);
}
