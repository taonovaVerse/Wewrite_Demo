import type { StyleMetrics } from '../style/types.js';

export const DEFAULT_TABOO =
  '氛围感、治愈、温暖地、深沉地、仿佛、似乎、某种说不清的、淡淡地、轻轻地、渐渐地、缓缓地、微微地、隐隐地、不由自主地、下意识地、眸中闪过一丝、眼底掠过、嘴角勾起一抹、垂下眼帘、深吸一口气、心头一紧、涌过一阵暖流、空气仿佛凝固、命运的齿轮、氤氲';

const AI_PATTERNS =
  '句式雷区：三连排比、对称句式滥用；结尾总结式升华（"这或许就是生活的意义"类）；把情绪写成名词状态（"她很悲伤""气氛尴尬"）——要用具体动作与物件让情绪自己露出来。';

export const AUTOCOMPLETE_SYSTEM = `你是小说写作的自动补全引擎。你会收到光标前文字与光标后文字，任务是补全紧接光标处最自然的下一个句子（或句子后半句）。

规则：
1. 只输出补全内容本身，不解释、不重复上下文。
2. 长度 10-40 字（一句以内），选择最自然、最可能的一种走向，不炫技。
3. 严格贴合前文语感、节奏、人称与视角（见文风档案）。
4. 当续写方向有明显分叉时，选择延续当前句子语义的最小补全。
5. 杜绝 AI 腔与陈词滥调。禁用词：${DEFAULT_TABOO}。
6. 逻辑一致性：不得凭空引入前文未出现的人物、物件或设定；拿不准就宁可不写，不可编造。
7. 人物贴合：补全涉及在场人物时，其言行、语气必须符合该人物的身份与口癖（见「在场人物」）。
8. 话题延续：延续当前句的主语与话题自然前进，不跳转、不总结、不升华。`;

export const CONTINUE_SYSTEM = `你是一位资深中文小说写手，正在协助作者续写小说正文。

核心创作理念：作者把控全局走向，AI 负责局部执行。你的输出只是草稿建议，作者会逐字审阅修改，因此你必须：可读、克制、不越权。

职责：
1. 严格遵循作者已批准的大纲与设定，绝不引入新设定、新人物，不违背已确立事实（防吃书）。若续写会偏离大纲，先输出【偏离预警】说明，再给出续写正文，而不是擅自改写。
2. 模仿作者文风、节奏、人称与叙述视角（见文风档案）。
3. 紧接上文结尾自然推进，长度 300-500 字，一段即可。
4. 涉及细节时优先采用有质感的具体描写，杜绝 AI 腔。

禁用词（AI腔）：${DEFAULT_TABOO}。${AI_PATTERNS}用名词、动词、量词、具体数字替代抽象形容词。

反例：把"他感觉很温暖"改为"他把手往羽绒服兜里缩了缩，热气贴着掌心"。`;

export interface CharacterCtx {
  name: string;
  profile: string;
  speaking_style: string;
  status: string;
}

function formatCharacters(characters: CharacterCtx[]): string {
  return characters
    .map(
      (c) =>
        `- ${c.name}：${c.profile || '—'}` +
        (c.speaking_style ? `\n  口癖/说话习惯：${c.speaking_style}` : '') +
        (c.status ? `\n  当前状态：${c.status}` : ''),
    )
    .join('\n');
}

export interface Scene {
  location: string;
  time_frame: string;
  emotion: string;
  theme: string;
}

function sceneLines(scene: Partial<Scene>): string[] {
  const rows: [string, string | undefined][] = [
    ['地点', scene.location],
    ['时间段', scene.time_frame],
    ['情绪', scene.emotion],
    ['主题', scene.theme],
  ];
  const out: string[] = [];
  for (const [k, v] of rows) {
    if (v?.trim()) out.push(`${k}：${v}`);
  }
  return out;
}

/** 场景信息非空时，以「当前场景」区块注入 prompt */
function pushSceneSection(parts: string[], scene: Partial<Scene> | undefined): void {
  if (!scene) return;
  const lines = sceneLines(scene);
  if (lines.length > 0) parts.push(section('当前场景', lines.join('\n')));
}

export interface ContinueContext {
  style: { voice: string; rhythm_notes: string; taboo_words: string };
  scene?: Scene;
  characters: CharacterCtx[];
  settings: { key: string; value: string }[];
  foreshadowing: string[];
  blueprint: string;
  summary: string;
  recent: string;
}

function section(title: string, body: string): string {
  return `## ${title}\n${body}`;
}

export const DETAIL_SYSTEM = `你是一位善于捕捉生活质感的中文小说写手。作者给了一个"卡壳"的场景，请你基于作者提供的素材范例，写出一段有真实生活质感的细节描写。

要求：
1. 至少调用 3 种感官通道（视觉/听觉/触觉/嗅觉/味觉），自然融入文内，不要列出通道名称。
2. 使用具体物件、具体动作、具体数字；禁止抽象形容词堆砌（"美丽的""温馨的""氛围感"一律替换成可触摸的细节）。
3. 严格模仿素材范例的选材习惯与口吻——那是作者本人的生活观察，不要另起炉灶堆辞藻。
4. 符合人物身份与环境：穷人不会用奢侈品，南方没有暖气片，角色怕冷就别写他赤膊。
5. 长度 100-300 字，一段，不加总结语。
6. 杜绝 AI 腔。禁用词：${DEFAULT_TABOO}。${AI_PATTERNS}`;

export interface DetailContext {
  style: { voice: string; taboo_words: string };
  scene?: Scene;
  scenePrompt: string;
  before: string;
  examples: string[];
}

export function formatDetailUser(data: DetailContext): string {
  const parts: string[] = [];
  parts.push(
    section(
      '文风档案',
      [data.style.voice, `禁用词：${data.style.taboo_words || DEFAULT_TABOO}`]
        .filter(Boolean)
        .join('\n'),
    ),
  );
  pushSceneSection(parts, data.scene);
  parts.push(section('卡壳场景', data.scenePrompt || '（未指定，请基于上下文自然展开）'));
  if (data.before) parts.push(section('当前正文（衔接处）', data.before.slice(-800)));
  if (data.examples.length > 0) {
    parts.push(
      section(
        '作者素材范例（模仿其质感）',
        data.examples.map((e, i) => `${i + 1}. ${e}`).join('\n'),
      ),
    );
  }
  parts.push('## 你的任务\n写出这段细节描写。直接输出正文。');
  return parts.join('\n\n');
}

export interface AutocompleteContext {
  style: { voice: string; taboo_words: string };
  scene?: Partial<Scene>;
  characters: CharacterCtx[];
  before: string;
  after: string;
}

export function formatAutocompleteUser(data: AutocompleteContext): string {
  const styleLines = [data.style.voice];
  styleLines.push(`禁用词：${data.style.taboo_words || DEFAULT_TABOO}`);
  const parts: string[] = [];
  parts.push(section('文风档案', styleLines.filter(Boolean).join('\n')));
  pushSceneSection(parts, data.scene);
  if (data.characters.length > 0) {
    parts.push(section('在场人物', formatCharacters(data.characters.slice(0, 4))));
  }
  parts.push(section('前文（光标前）', data.before || '（空）'));
  parts.push(section('后文（光标后）', data.after || '（空）'));
  parts.push('## 补全光标处：');
  return parts.join('\n\n');
}

export function formatContinueUser(data: ContinueContext): string {
  const parts: string[] = [];

  const styleLines = [data.style.voice];
  if (data.style.rhythm_notes) styleLines.push(`节奏：${data.style.rhythm_notes}`);
  const taboo = data.style.taboo_words || DEFAULT_TABOO;
  styleLines.push(`禁用词：${taboo}`);
  parts.push(section('文风档案', styleLines.filter(Boolean).join('\n')));

  pushSceneSection(parts, data.scene);

  if (data.characters.length > 0) {
    parts.push(section('人物卡（当前场景相关）', formatCharacters(data.characters)));
  }

  if (data.settings.length > 0) {
    parts.push(
      section('世界观设定', data.settings.map((s) => `- ${s.key}：${s.value}`).join('\n')),
    );
  }

  if (data.foreshadowing.length > 0) {
    parts.push(section('伏笔表', data.foreshadowing.map((f) => `- ${f}`).join('\n')));
  }

  if (data.blueprint) {
    parts.push(section('章节细纲（蓝图）', data.blueprint));
  }

  if (data.summary) {
    parts.push(section('已写正文摘要', data.summary));
  }

  if (data.recent) {
    parts.push(section('最近正文', data.recent));
  }

  parts.push(`## 你的任务\n紧接以上正文末尾，续写下一段。直接输出续写正文，不要任何解释或开头语。`);
  return parts.join('\n\n');
}

export const ASSISTANT_SYSTEM = `你是一位资深中文小说写作助手，熟悉这部小说的全书设定。你的职责是协助作者分析、构思、查证、修改——作者是船长，你负责局部最优，不越权改写正文。

对话规则：
1. 多轮对话：结合本次对话历史理解作者意图；作者可追问、可改口，以最新一轮问题为准。
2. 结论必须有原文依据：引用正文原句（用引号），先引后评；没有依据的观察就明说「未发现」，绝不脑补编造。
3. 对齐「本章客观数据」：句长 / 段落 / 对白 / 感官细节 / 词汇多样性与你的判断一致时，点出数据佐证；数据不支持时不要硬套。
4. 尊重作者文风档案的口吻与节奏；发现作者用了 AI 腔禁用词（${DEFAULT_TABOO}，或文风档案中的禁用词）时点名指出，并给出更具体的替代方向。${AI_PATTERNS}
5. 全书范围：人物卡 / 世界观 / 伏笔 / 细纲均为全书数据，可跨章节引用；涉及具体文字判断时以「当前章节正文」为准。
6. 建议要可执行：给方向与示例句即可；除非作者明确要求改写（见改写任务），否则不输出整段可粘贴的替换稿。`;

export const REWRITE_SYSTEM = `你是一位资深中文小说润色编辑。作者选中了正文中一段文字，要求改写。

输出规则：
1. 只输出改写后的文本本身：不解释、不加引号、不重复原文、不要任何前缀或说明。
2. 保留原意与人物口吻，严格贴合作者文风档案（见文风档案）。
3. 按作者的改写意图执行：要求压缩就压缩、要求扩写就扩写、要求换语气就换语气；方向不明确时以最小改动还原其意图。
4. 杜绝 AI 腔。禁用词：${DEFAULT_TABOO}。${AI_PATTERNS}`;

export interface AssistantContext {
  style: { voice: string; rhythm_notes: string; taboo_words: string };
  scene?: Scene;
  characters: CharacterCtx[];
  settings: { key: string; value: string }[];
  foreshadowing: string[];
  blueprint: string;
  /** L5 单章客观数据（formatMetrics 产出） */
  metrics: string;
  chapterText: string;
  /** 多轮对话历史（不含当前轮），role 限定 user/assistant */
  history?: { role: 'user' | 'assistant'; content: string }[];
  mode: 'ask' | 'rewrite';
  /** 当前轮作者输入（ask=问题；rewrite=改写要求） */
  question: string;
  /** rewrite 模式下被改写的原文 */
  originalText?: string;
}

/** 把单章 StyleMetrics 压成紧凑的「本章客观数据」块，作为助手的量化依据 */
export function formatMetrics(m: StyleMetrics): string {
  const pct = (r: number): string => `${Math.round(r * 100)}%`;
  const lines = [
    `- 篇幅：本章 ${m.totalChars} 字`,
    `- 句长：平均 ${m.sentence.avgLen} 字，中位 ${m.sentence.medianLen}；短句（≤8字）${pct(m.sentence.shortRatio)}，长句（>25字）${pct(m.sentence.longRatio)}`,
    `- 段落：平均 ${m.paragraph.avgLen} 字，最长 ${m.paragraph.maxLen} 字（${m.paragraph.count} 段）`,
    `- 对白：占比 ${pct(m.dialogue.ratio)}（${m.dialogue.segmentCount} 段）`,
    `- 感官细节：约 ${m.description.cuePerThousand} 处/千字`,
    `- 词汇：汉字 TTR ${m.vocabulary.hanziTTR}，双字 TTR ${m.vocabulary.bigramTTR}`,
  ];
  const tri = m.vocabulary.topTrigrams.slice(0, 5);
  if (tri.length > 0) lines.push(`- 高频三字短语：${tri.join('、')}`);
  return lines.join('\n');
}

export function formatAssistantUser(data: AssistantContext): string {
  const parts: string[] = [];

  const styleLines = [data.style.voice];
  if (data.style.rhythm_notes) styleLines.push(`节奏：${data.style.rhythm_notes}`);
  styleLines.push(`禁用词：${data.style.taboo_words || DEFAULT_TABOO}`);
  parts.push(section('文风档案', styleLines.filter(Boolean).join('\n')));

  pushSceneSection(parts, data.scene);

  if (data.characters.length > 0) {
    parts.push(section('人物卡（全书）', formatCharacters(data.characters)));
  }

  if (data.settings.length > 0) {
    parts.push(
      section('世界观设定', data.settings.map((s) => `- ${s.key}：${s.value}`).join('\n')),
    );
  }

  if (data.foreshadowing.length > 0) {
    parts.push(section('伏笔表', data.foreshadowing.map((f) => `- ${f}`).join('\n')));
  }

  if (data.blueprint) {
    parts.push(section('章节细纲（蓝图）', data.blueprint));
  }

  parts.push(section('本章客观数据（L5 文风分析结果）', data.metrics));
  parts.push(section('当前章节正文', data.chapterText));

  if (data.history && data.history.length > 0) {
    const lines = data.history.map((m) => `${m.role === 'user' ? '作者' : '助手'}：${m.content}`);
    parts.push(section('对话历史', lines.join('\n')));
  }

  if (data.mode === 'rewrite') {
    parts.push(
      '## 你的任务\n' +
        `作者选中了下面这段正文要求改写：\n"${data.originalText}"\n` +
        `作者要求：${data.question}\n直接输出改写后的文本，不要任何解释、前缀或引号。`,
    );
  } else {
    parts.push(`## 你的任务\n${data.question}`);
  }
  return parts.join('\n\n');
}
