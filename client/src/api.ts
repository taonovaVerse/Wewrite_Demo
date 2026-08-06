export interface Novel {
  id: number;
  title: string;
  folder: string;
  created_at: string;
  updated_at: string;
  /** true = 外部文件夹（folder 为绝对路径）；false/缺省 = 内部小说 */
  external?: boolean;
}

export interface Chapter {
  id: number;
  novel_id: number;
  order_idx: number;
  title: string;
  content: string;
  blueprint: string;
  location: string;
  time_frame: string;
  emotion: string;
  theme: string;
  scene_characters: string;
  status: string;
  folder: string;
  path: string;
  created_at: string;
  updated_at: string;
}

/** 资源管理器文件树节点（chapterId 仅在 file 节点上有值） */
export interface FileNode {
  name: string;
  type: 'file' | 'folder';
  path: string;
  folder: string;
  chapterId?: number;
  children?: FileNode[];
}

/** 世界文档类型：5 类管理数据在磁盘 .docs/<类>/*.md 的 kind */
export type DocKind = 'characters' | 'world' | 'foreshadow' | 'style' | 'bank';

/** 世界文档：fields 为 front-matter 结构化字段（除 id），body 为正文 */
export interface DocRow {
  kind: DocKind;
  id: number;
  novel_id: number;
  title: string;
  body: string;
  fields: Record<string, string | number | null>;
  path: string;
}

export interface NovelDetail extends Novel {
  tree: FileNode[];
  chapters: Chapter[];
  docs: DocRow[];
}

/** 章节更新请求体（API 用 camelCase，区别于 DB 行的 snake_case） */
export interface ChapterPatch {
  title?: string;
  content?: string;
  blueprint?: string;
  location?: string;
  timeFrame?: string;
  emotion?: string;
  theme?: string;
  sceneCharacters?: string[];
  status?: string;
}

export interface Character {
  id: number;
  novel_id: number;
  name: string;
  profile: string;
  speaking_style: string;
  status: string;
}

export interface WorldSetting {
  id: number;
  novel_id: number;
  key: string;
  value: string;
}

export interface Foreshadowing {
  id: number;
  novel_id: number;
  planted_chapter: number | null;
  resolved_chapter: number | null;
  note: string;
}

export interface StyleProfile {
  id: number | null;
  novel_id: number;
  voice: string;
  rhythm_notes: string;
  taboo_words: string;
}

export interface CharacterInput {
  novelId: number;
  name: string;
  profile: string;
  speakingStyle: string;
  status: string;
}

export interface WorldSettingInput {
  novelId: number;
  key: string;
  value: string;
}

export interface ForeshadowingInput {
  novelId: number;
  plantedChapter?: number | null;
  resolvedChapter?: number | null;
  note: string;
}

export interface DetailBankEntry {
  id: number;
  novel_id: number;
  scene_type: string;
  sensory_channel: string;
  content: string;
  tags: string;
}

export interface DetailBankInput {
  novelId: number;
  sceneType: string;
  sensoryChannel: string;
  content: string;
  tags: string;
}

import { apiUrl } from './apiBase';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(url), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  novels: () => request<Novel[]>('/api/novels'),
  createNovel: (title: string) =>
    request<Novel>('/api/novels', { method: 'POST', body: JSON.stringify({ title }) }),
  openNovelFolder: (path: string) =>
    request<Novel>('/api/novels/open', { method: 'POST', body: JSON.stringify({ path }) }),
  renameNovel: (id: number, title: string) =>
    request<Novel>(`/api/novels/${id}`, { method: 'PUT', body: JSON.stringify({ title }) }),
  deleteNovel: (id: number) =>
    request<void>(`/api/novels/${id}`, { method: 'DELETE' }),
  novel: (id: number) => request<NovelDetail>(`/api/novels/${id}`),
  createChapter: (novelId: number, title: string, folder = '') =>
    request<Chapter>(`/api/novels/${novelId}/chapters`, {
      method: 'POST',
      body: JSON.stringify({ title, folder }),
    }),
  createFolder: (novelId: number, name: string, parent = '') =>
    request<{ folder: string }>(`/api/novels/${novelId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ name, parent }),
    }),
  deleteFolder: (novelId: number, folder: string) =>
    request<void>(`/api/novels/${novelId}/folders`, {
      method: 'DELETE',
      body: JSON.stringify({ folder }),
    }),
  renameFolder: (novelId: number, folder: string, name: string) =>
    request<{ folder: string }>(`/api/novels/${novelId}/folders/rename`, {
      method: 'POST',
      body: JSON.stringify({ folder, name }),
    }),
  moveChapter: (data: { novelId: number; chapterId: number; folder: string; beforeId?: number }) =>
    request<Chapter>('/api/chapters/move', { method: 'POST', body: JSON.stringify(data) }),
  saveChapter: (id: number, patch: ChapterPatch) =>
    request<Chapter>(`/api/chapters/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  deleteChapter: (id: number) =>
    request<void>(`/api/chapters/${id}`, { method: 'DELETE' }),

  listDocs: (novelId: number, kind: DocKind) =>
    request<DocRow[]>(`/api/docs?novelId=${novelId}&kind=${kind}`),
  getDoc: (novelId: number, kind: DocKind, id: number) =>
    request<DocRow>(`/api/docs/${kind}/${id}?novelId=${novelId}`),
  createDoc: (data: { novelId: number; kind: DocKind; title?: string }) =>
    request<DocRow>('/api/docs', { method: 'POST', body: JSON.stringify(data) }),
  saveDoc: (
    kind: DocKind,
    id: number,
    data: {
      novelId: number;
      body?: string;
      fields?: Record<string, string | number | null>;
      title?: string;
    },
  ) =>
    request<DocRow>(`/api/docs/${kind}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDoc: (novelId: number, kind: DocKind, id: number) =>
    request<void>(`/api/docs/${kind}/${id}?novelId=${novelId}`, { method: 'DELETE' }),

  characters: (novelId: number) =>
    request<Character[]>(`/api/characters?novelId=${novelId}`),
  createCharacter: (data: CharacterInput) =>
    request<Character>('/api/characters', { method: 'POST', body: JSON.stringify(data) }),
  updateCharacter: (id: number, patch: Partial<CharacterInput>) =>
    request<Character>(`/api/characters/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteCharacter: (id: number) =>
    request<void>(`/api/characters/${id}`, { method: 'DELETE' }),

  worldSettings: (novelId: number) =>
    request<WorldSetting[]>(`/api/world-settings?novelId=${novelId}`),
  createWorldSetting: (data: WorldSettingInput) =>
    request<WorldSetting>('/api/world-settings', { method: 'POST', body: JSON.stringify(data) }),
  updateWorldSetting: (id: number, patch: Partial<WorldSettingInput>) =>
    request<WorldSetting>(`/api/world-settings/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteWorldSetting: (id: number) =>
    request<void>(`/api/world-settings/${id}`, { method: 'DELETE' }),

  foreshadowing: (novelId: number) =>
    request<Foreshadowing[]>(`/api/foreshadowing?novelId=${novelId}`),
  createForeshadowing: (data: ForeshadowingInput) =>
    request<Foreshadowing>('/api/foreshadowing', { method: 'POST', body: JSON.stringify(data) }),
  updateForeshadowing: (id: number, patch: Partial<ForeshadowingInput>) =>
    request<Foreshadowing>(`/api/foreshadowing/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  deleteForeshadowing: (id: number) =>
    request<void>(`/api/foreshadowing/${id}`, { method: 'DELETE' }),

  styleProfile: (novelId: number) =>
    request<StyleProfile>(`/api/style-profile?novelId=${novelId}`),
  saveStyleProfile: (data: { novelId: number; voice: string; rhythmNotes: string; tabooWords: string }) =>
    request<StyleProfile>('/api/style-profile', { method: 'PUT', body: JSON.stringify(data) }),

  detailBank: {
    list: (novelId: number, q = '') =>
      request<DetailBankEntry[]>(
        `/api/detail-bank?novelId=${novelId}` + (q ? `&q=${encodeURIComponent(q)}` : ''),
      ),
    create: (data: DetailBankInput) =>
      request<DetailBankEntry>('/api/detail-bank', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, patch: Partial<DetailBankInput>) =>
      request<DetailBankEntry>(`/api/detail-bank/${id}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      }),
    remove: (id: number) =>
      request<void>(`/api/detail-bank/${id}`, { method: 'DELETE' }),
  },
};
