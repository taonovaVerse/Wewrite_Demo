// 临时 CDP：全书 AI 助手 + 自动查资料冒烟。
// Fetch 拦截 /api/ai/assistant 喂假 SSE（sources 事件 + token），不触真实 AI、不写库。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9342;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-bookask-'));

const novels = await (await fetch('http://localhost:4000/api/novels')).json();
const novelId = novels[0].id;
const detail = await (await fetch(`http://localhost:4000/api/novels/${novelId}`)).json();
const chapter = detail.chapters[0];

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

let results = [];
function check(name, ok, extra = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
}

const ws = new WebSocket(await getWsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let askHits = [];
let pageErrors = [];

async function handlePaused(requestId, request) {
  if (request.url.includes('/api/ai/assistant')) {
    let post = request.postData ?? '';
    if (!post && request.postDataEntries?.length) {
      post = Buffer.from(request.postDataEntries[0].bytes, 'base64').toString('utf8');
    }
    let body = {};
    try { body = JSON.parse(post || '{}'); } catch { }
    askHits.push({
      mode: body.mode ?? 'ask',
      novelId: body.novelId ?? null,
      chapterId: body.chapterId ?? null,
      msgCount: body.messages?.length,
    });
    const items = [
      { kind: 'chapter', title: '第一章 雨夜', excerpt: '雨下到后半夜，便利店的灯还亮着。收银机吐出一张热腾腾的小票。' },
      { kind: 'bank', title: '便利店', excerpt: '关东煮的锅沿冒热气，塑料盖被水汽顶得轻轻作响。' },
    ];
    const sse = [
      `data: ${JSON.stringify({ type: 'sources', items })}\n\n`,
      `data: ${JSON.stringify({ type: 'token', text: '（助手回答）全书检索到相关设定：雨夜便利店…' })}\n\n`,
      `data: ${JSON.stringify({ type: 'done' })}\n\n`,
    ].join('');
    await cdp(ws, 'Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'text/event-stream' }],
      body: Buffer.from(sse, 'utf8').toString('base64'),
    });
    return;
  }
  await cdp(ws, 'Fetch.continueRequest', { requestId });
}

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Page.javascriptDialogOpening') {
    void cdp(ws, 'Page.handleJavaScriptDialog', { accept: true });
    return;
  }
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    return;
  }
  if (m.method === 'Fetch.requestPaused') {
    void handlePaused(m.params.requestId, m.params.request).catch((err) => {
      console.log('intercept error:', err.message);
      void cdp(ws, 'Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => { });
    });
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    pageErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text ?? '');
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    pageErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
};

await cdp(ws, 'Page.enable');
await cdp(ws, 'Runtime.enable');
await cdp(ws, 'Fetch.enable', {
  patterns: [{ urlPattern: '*assistant*', requestStage: 'Request' }],
});

for (let i = 0; i < 30; i++) {
  const title = await evaluate(ws, `document.querySelector('#sidebar-header span')?.textContent ?? ''`);
  if (title === '资源管理器') break;
  await sleep(300);
}

async function askQuestion(q) {
  await evaluate(ws, `(() => {
    const i = document.getElementById('assistant-input');
    i.value = ${JSON.stringify(q)};
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return 'ok';
  })()`);
}

// ---- 1. 不开章节 → 进助手，直接提问（全书） ----
console.log('\n=== 1. 全书提问（无打开章节） ===');
await evaluate(ws, `document.querySelector('#activitybar [data-view="assistant"]')?.click()`);
await sleep(800);
check('助手视图已打开（显示当前小说）', await evaluate(ws, `document.querySelector('.assistant-thread') != null && (document.querySelector('#sidebar-body .view-hint')?.textContent ?? '').includes('当前小说')`));
await askQuestion('雨夜便利店的设定是什么？');
await sleep(1500);
check('请求体含 novelId（无 chapterId）', askHits.length > 0 && askHits[askHits.length - 1].novelId === novelId && askHits[askHits.length - 1].chapterId == null, JSON.stringify(askHits[askHits.length - 1] ?? null));
check('回答上方出现「检索资料（2）」', await evaluate(ws, `document.querySelector('.assistant-sources summary')?.textContent.includes('检索资料（2）') ?? false`));
check('资料条目含章节与素材', await evaluate(ws, `[...document.querySelectorAll('.assistant-source-title')].map(t => t.textContent).join(',')`) === '章节《第一章 雨夜》,素材库');
check('回答气泡已流式填充', await evaluate(ws, `document.querySelector('.assistant-thread .view-item-body')?.textContent.includes('（助手回答）') ?? false`));
const users1 = await evaluate(ws, `document.querySelectorAll('.assistant-user').length`);
check('本轮用户气泡计 1', users1 === 1, `count=${users1}`);

// ---- 2. 切章节 tab 再回助手 → 线程不重置，继续追问 ----
console.log('\n=== 2. 切换章节不重置线程 ===');
await evaluate(ws, `document.querySelector('#activitybar [data-view="explorer"]')?.click()`);
await sleep(600);
await evaluate(ws, `(() => { const row = document.querySelector('.tree-chapter'); if (!row) return 'NO_ROW'; row.click(); return 'ok'; })()`);
await sleep(1200);
await evaluate(ws, `document.querySelector('#activitybar [data-view="assistant"]')?.click()`);
await sleep(800);
const usersAfterSwitch = await evaluate(ws, `document.querySelectorAll('.assistant-user').length`);
check('切章节后线程仍保留（1 条用户消息）', usersAfterSwitch === 1, `count=${usersAfterSwitch}`);
await askQuestion('那关门前的雨声是怎么写的？');
await sleep(1500);
check('追加后用户气泡计 2', await evaluate(ws, `document.querySelectorAll('.assistant-user').length`) === 2);
check('打开章节后请求体含 chapterId', askHits.length >= 2 && askHits[askHits.length - 1].chapterId === chapter.id, JSON.stringify(askHits[askHits.length - 1] ?? null));
// 首轮资料块是运行时 DOM，重渲染（切 tab）后按设计清除；断言最新一轮回答紧邻的资料块存在
check('第二轮同样带检索资料', await evaluate(ws, `(() => {
  const s = [...document.querySelectorAll('.assistant-sources')];
  if (s.length === 0) return false;
  const last = s[s.length - 1];
  const answers = [...document.querySelectorAll('.assistant-thread .view-item-body')];
  return last.nextElementSibling === answers[answers.length - 1];
})()`));

// ---- 汇总 ----
console.log('\n========== 汇总 ==========');
const pass = results.filter(Boolean).length;
console.log(`PASS ${pass}/${results.length}`);
if (pageErrors.length) {
  console.log('\n--- 页面 JS 错误 ---');
  for (const e of pageErrors.slice(0, 10)) console.log('  ', e.slice(0, 200));
}
child.kill('SIGTERM');
ws.close();
await sleep(500);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
process.exit(pass === results.length ? 0 : 1);
