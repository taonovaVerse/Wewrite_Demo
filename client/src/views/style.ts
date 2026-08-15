import { app } from '../app';
import { api, type StyleAnalyzeResult, type StyleProfile } from '../api';
import { el, val, field, actionBtn, flashSaved } from '../ui';
import type { SidebarView } from './types';

async function render(c: HTMLElement): Promise<void> {
  c.innerHTML = '';
  const novelId = app.currentNovel?.id;
  const wrap = el('div', 'view-section');
  if (!novelId) {
    wrap.appendChild(el('div', 'view-hint', '先在资源管理器中选择一部小说。'));
    c.appendChild(wrap);
    return;
  }
  const sp: StyleProfile | null = await api.styleProfile(novelId);
  const hint = el(
    'div',
    'view-hint',
    '文风档案进入续写/补全的稳定前缀。taboo_words 留空时用内置默认禁用词表。',
  );
  const form = el('div', 'view-form');
  form.append(
    field('style-voice', '叙述口吻', sp?.voice ?? '', {
      textarea: true,
      rows: 2,
      placeholder: '冷峻克制，白描为主…',
    }),
    field('style-rhythm', '节奏说明', sp?.rhythm_notes ?? '', {
      textarea: true,
      rows: 2,
      placeholder: '短句多，少长从句…',
    }),
    field('style-taboo', '禁用词（逗号分隔，AI腔）', sp?.taboo_words ?? '', {
      textarea: true,
      rows: 2,
      placeholder: '氛围感、治愈、仿佛…',
    }),
  );
  const analyzeRow = el('div', 'view-form-row');
  const analyzeBtn = actionBtn('分析文风', false, () => void runAnalyze(analyzeBtn, wrap));
  analyzeRow.appendChild(analyzeBtn);
  form.appendChild(analyzeRow);

  const saveRow = el('div', 'view-form-row');
  const saveBtn = actionBtn('保存文风', false, () => void saveStyle(saveBtn));
  saveRow.appendChild(saveBtn);
  form.appendChild(saveRow);

  wrap.append(hint, form);
  c.appendChild(wrap);
}

async function saveStyle(btn: HTMLElement): Promise<void> {
  const novelId = app.currentNovel?.id;
  if (!novelId) return;
  await api.saveStyleProfile({
    novelId,
    voice: val('style-voice'),
    rhythmNotes: val('style-rhythm'),
    tabooWords: val('style-taboo'),
  });
  flashSaved(btn, '保存文风');
}

async function runAnalyze(btn: HTMLElement, wrap: HTMLElement): Promise<void> {
  const novelId = app.currentNovel?.id;
  if (!novelId) return;
  wrap.querySelector('.style-preview')?.remove();
  btn.textContent = '分析中…';
  try {
    wrap.appendChild(renderPreview(await api.analyzeStyle(novelId)));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const node = el('div', 'view-hint style-preview');
    node.textContent = `分析失败：${msg}`;
    wrap.appendChild(node);
  } finally {
    btn.textContent = '分析文风';
  }
}

function pct(r: number): string {
  return `${Math.round(r * 100)}%`;
}

function setVal(id: string, value: string): void {
  const node = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (node) node.value = value;
}

/** 指标 + 生成的 voice/rhythm 只读预览；「填入文风档案」把建议写进上方表单（作者保存后才落盘） */
function renderPreview(r: StyleAnalyzeResult): HTMLElement {
  const sec = el('div', 'view-section style-preview');
  if (r.meta.note) sec.appendChild(el('div', 'view-hint', r.meta.note));

  const m = r.metrics;
  const lines: [string, string][] = [
    ['样本', `${m.chapterCount} 章 / 共 ${m.totalChars} 字`],
    [
      '句长',
      `平均 ${m.sentence.avgLen} 字，中位 ${m.sentence.medianLen}；短句（≤8字）${pct(m.sentence.shortRatio)}，长句（>25字）${pct(m.sentence.longRatio)}`,
    ],
    [
      '段落',
      `平均 ${m.paragraph.avgLen} 字，最长 ${m.paragraph.maxLen} 字（${m.paragraph.count} 段）`,
    ],
    [
      '对白',
      `占 ${pct(m.dialogue.ratio)}（${m.dialogue.segmentCount} 段，单段均 ${m.dialogue.avgSegLen} 字）`,
    ],
    ['感官细节', `约 ${m.description.cuePerThousand} 处/千字`],
    ['词汇', `汉字 TTR ${m.vocabulary.hanziTTR}，双字 TTR ${m.vocabulary.bigramTTR}`],
  ];
  for (const [k, v] of lines) {
    sec.appendChild(el('div', 'view-hint', `${k}：${v}`));
  }

  if (m.vocabulary.topTrigrams.length > 0) {
    sec.appendChild(
      el(
        'div',
        'view-hint',
        `高频三字短语：${m.vocabulary.topTrigrams.join('、')}（口头禅提示，仅供自查，不会写入禁用词）`,
      ),
    );
  }

  const gen = el('div', 'view-form');
  const voiceField = field('preview-voice', '建议的叙述口吻', r.generated.voice, {
    textarea: true,
    rows: 3,
  });
  const rhythmField = field('preview-rhythm', '建议的节奏说明', r.generated.rhythm_notes, {
    textarea: true,
    rows: 3,
  });
  voiceField.querySelector('textarea')?.setAttribute('readonly', 'readonly');
  rhythmField.querySelector('textarea')?.setAttribute('readonly', 'readonly');
  gen.append(voiceField, rhythmField);

  const row = el('div', 'view-form-row');
  row.appendChild(
    actionBtn('填入文风档案', false, () => {
      setVal('style-voice', r.generated.voice);
      setVal('style-rhythm', r.generated.rhythm_notes);
      const first = document.getElementById('style-voice');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first?.focus();
    }),
  );
  gen.appendChild(row);
  sec.appendChild(gen);
  return sec;
}

export const styleView: SidebarView = {
  id: 'style',
  label: '文风',
  headerTitle: '编辑文风档案',
  render,
  headerButton: () => void render(document.getElementById('sidebar-body')!),
};
