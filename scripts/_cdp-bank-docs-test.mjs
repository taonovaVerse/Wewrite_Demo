// 临时 CDP：验证素材库恢复为文档文件列表——资源管理器列出 .docs/素材库/*.md，点击打开编辑器，可新建/删除。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9338;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${tmp}`,
  'http://localhost:5173/',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const pages = await r.json();
      const page = pages.find((p) => p.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { }
    await sleep(250);
  }
  throw new Error('CDP endpoint not ready');
}
let msgId = 0;
const pending = new Map();
function cdp(ws, method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`timeout ${method}`)); }, 15000);
  });
}
async function evaluate(ws, expr) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`JS error: ${JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)}`);
  return r.result?.value;
}
const click = (ws, js) => evaluate(ws, `(() => { const e = ${js}; if (!e) return 'NOT_FOUND'; e.click(); return 'ok'; })()`);
const bankRows = (ws) => evaluate(ws, `(() => { const s = [...document.querySelectorAll('.tree-section')].find((x) => x.querySelector('.tree-section-title span')?.textContent === '素材库'); return s ? s.querySelectorAll('.tree-doc').length : -1; })()`);
const bankTitles = (ws) => evaluate(ws, `(() => { const s = [...document.querySelectorAll('.tree-section')].find((x) => x.querySelector('.tree-section-title span')?.textContent === '素材库'); return s ? [...s.querySelectorAll('.tree-doc-title')].map((e) => e.textContent) : []; })()`);

const ws = new WebSocket(await getWsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
  }
};
for (let i = 0; i < 20; i++) {
  const t = await evaluate(ws, `document.querySelector('#sidebar-header span')?.textContent ?? ''`);
  if (t === '资源管理器') break;
  await sleep(300);
}
await sleep(800);

// 1. 活动栏图标：无 bank，共 6 个
const icons = await evaluate(ws, `[...document.querySelectorAll('#activitybar .activity-item')].map((b) => b.dataset.view)`);
console.log('活动栏图标:', JSON.stringify(icons), '| 含bank?', icons.includes('bank'), '| 数量:', icons.length);

// 2. 素材库区块是文档列表，种子 2 条
const titles0 = await bankTitles(ws);
const rows0 = await bankRows(ws);
console.log('素材库文档标题:', JSON.stringify(titles0), '| 初始条数:', rows0, '(应 2)');

// 3. 点第一条 → 编辑器打开文档 tab
await click(ws, `(() => { const s = [...document.querySelectorAll('.tree-section')].find((x) => x.querySelector('.tree-section-title span')?.textContent === '素材库'); return s?.querySelector('.tree-doc'); })()`);
await sleep(900);
const tabInfo = await evaluate(ws, `(() => { const t = document.querySelector('#tabs .tab.active'); const txt = document.querySelector('#editor-wrap .cm-content')?.textContent ?? ''; return { tabTitle: t?.querySelector('.tab-title')?.textContent ?? null, editorLen: txt.length, activeView: document.querySelector('#sidebar-header span')?.textContent }; })()`);
console.log('点文档行后 tab:', JSON.stringify(tabInfo), '| 应打开文档 tab 且编辑器有内容');

// 4. ＋新建素材文档 → 条数 +1
await click(ws, `(() => { const s = [...document.querySelectorAll('.tree-section')].find((x) => x.querySelector('.tree-section-title span')?.textContent === '素材库'); return s?.querySelector('.sidebar-title-btn'); })()`);
await sleep(900);
const titles1 = await bankTitles(ws);
const rows1 = await bankRows(ws);
console.log('新建后条数:', rows1, '(应', rows0 + 1 + ') | 新增标题:', JSON.stringify(titles1.filter((t) => !titles0.includes(t))));

// 5. 删除刚建的这条（覆写 confirm 为 true）
await evaluate(ws, `window.confirm = () => true; 'ok'`);
await click(ws, `(() => { const s = [...document.querySelectorAll('.tree-section')].find((x) => x.querySelector('.tree-section-title span')?.textContent === '素材库'); const row = [...s.querySelectorAll('.tree-doc')].find((r) => !${JSON.stringify(titles0)}.includes(r.querySelector('.tree-doc-title').textContent)); const btn = [...row.querySelectorAll('.row-actions button')].find((b) => b.textContent === '删'); return btn; })()`);
await sleep(900);
const rows2 = await bankRows(ws);
console.log('删除后条数:', rows2, '(应回到', rows0 + ')');

// 6. 命令面板：无「素材库」命令
await cdp(ws, 'Runtime.evaluate', { expression: `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }))` });
await sleep(400);
const hasBankCmd = await evaluate(ws, `[...document.querySelectorAll('#palette-list .palette-item, #palette-list [role="option"]')].some((e) => e.textContent.includes('素材库'))`);
console.log('命令面板含「素材库」?', hasBankCmd, '(应 false)');

child.kill('SIGTERM');
ws.close();
await sleep(500);
try { await fs.promises.rm(tmp, { recursive: true, force: true }); } catch { }
process.exit(0);
