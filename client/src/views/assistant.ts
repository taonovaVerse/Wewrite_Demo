import { app, activeChapter } from '../app';
import { apiUrl } from '../apiBase';
import { el, field, actionBtn, val } from '../ui';
import { consumeSSE } from '../sse';
import type { SidebarView } from './types';

const inputId = 'assistant-input';
const threadId = 'assistant-thread';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

// 模块级状态：当前流式请求控制器 + 对话线程（跨重渲染保留）+ 线程锚定章节
let ctrl: AbortController | null = null;
let messages: Msg[] = [];
let threadChapterId: number | null = null;

function flashHint(text: string): void {
  const thread = document.getElementById(threadId);
  const hint = el('div', 'view-hint assistant-hint', text);
  thread?.appendChild(hint);
  setTimeout(() => hint.remove(), 2500);
}

async function render(c: HTMLElement): Promise<void> {
  ctrl?.abort();
  c.innerHTML = '';
  const wrap = el('div', 'view-section');
  const chapter = activeChapter();
  if (!chapter) {
    wrap.appendChild(el('div', 'view-hint', '先在资源管理器中打开一个章节，再与 AI 助手对话。'));
    c.appendChild(wrap);
    return;
  }

  let resetHint = false;
  if (threadChapterId !== chapter.id) {
    messages = [];
    threadChapterId = chapter.id;
    resetHint = true;
  }

  wrap.appendChild(
    el('div', 'view-hint', `当前章节：${chapter.title}。连续提问可多轮追问，助手会参考全书设定回答。`),
  );
  if (resetHint) {
    wrap.appendChild(el('div', 'view-hint', '已切换章节，会话已重置。'));
  }

  const thread = el('div', 'assistant-thread');
  thread.id = threadId;
  for (const m of messages) {
    if (m.role === 'user') {
      thread.appendChild(el('div', 'assistant-user', m.content));
    } else {
      thread.appendChild(el('div', 'view-item-body', m.content));
    }
  }
  wrap.appendChild(thread);

  const form = el('div', 'view-form');
  const qField = field(inputId, '消息', '', {
    placeholder: '问 AI 助手（Enter 发送）',
  });
  const qInput = qField.querySelector('input');
  qInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runAssistant();
    }
  });
  form.appendChild(qField);

  const row = el('div', 'view-form-row');
  row.appendChild(actionBtn('发送', false, () => runAssistant()));
  form.appendChild(row);
  wrap.appendChild(form);

  c.appendChild(wrap);
}

/** Ctrl+I 切到 AI 助手视图后聚焦输入框 */
export function focusAssistantInput(): void {
  const node = document.getElementById(inputId) as HTMLInputElement | HTMLTextAreaElement | null;
  node?.focus();
  node?.select();
}

function runAssistant(): void {
  const chapter = activeChapter();
  if (!chapter) return;
  const question = val(inputId);
  if (!question) {
    flashHint('请输入消息。');
    return;
  }
  const inputNode = document.getElementById(inputId) as HTMLInputElement | null;
  if (inputNode) inputNode.value = '';

  void streamIntoView(chapter.id, question);
}

/** 流式拉取 /api/ai/assistant（mode=ask），把 token 追加进线程；完成后存回消息线程 */
async function streamIntoView(chapterId: number, question: string): Promise<void> {
  ctrl?.abort();
  const ac = new AbortController();
  ctrl = ac;

  messages.push({ role: 'user', content: question });
  const thread = document.getElementById(threadId);
  thread?.appendChild(el('div', 'assistant-user', question));

  const answer = el('div', 'view-item-body');
  thread?.appendChild(answer);
  const status = el('div', 'view-hint', '思考中…');
  status.id = 'assistant-status';
  thread?.appendChild(status);

  const body = {
    chapterId,
    mode: 'ask',
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };

  try {
    const res = await fetch(apiUrl('/api/ai/assistant'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok || !res.body) {
      let message = `HTTP ${res.status}`;
      try {
        const b = (await res.json()) as { error?: string };
        if (b.error) message = b.error;
      } catch {
        /* 非 JSON 错误体，保留 HTTP 状态 */
      }
      throw new Error(message);
    }

    await consumeSSE(res.body, (evt) => {
      if (evt.type === 'token' && evt.text) {
        answer.textContent += evt.text;
      } else if (evt.type === 'error') {
        status.textContent = '✗ ' + (evt.message ?? '未知错误');
        status.className = 'view-hint assistant-error';
      }
    });
    status.remove();
  } catch (err) {
    answer.remove();
    status.remove();
    if (err instanceof DOMException && err.name === 'AbortError') return; // 切走/重发中断：半截答案不入线程
    flashHint('✗ ' + (err instanceof Error ? err.message : String(err)));
  } finally {
    if (ctrl === ac) ctrl = null;
  }

  // 正常完成或非中断错误：保留已流出的内容
  messages.push({ role: 'assistant', content: answer.textContent });
  if (messages.length > 20) messages.splice(0, messages.length - 20);
}

export const assistantView: SidebarView = {
  id: 'assistant',
  label: 'AI 助手',
  headerTitle: 'AI 助手（Ctrl+I）',
  render,
  headerButton: () => void render(document.getElementById('sidebar-body')!),
};
