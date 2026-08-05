export interface Novel {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Chapter {
  id: number;
  novel_id: number;
  order_idx: number;
  title: string;
  content: string;
  blueprint: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface NovelDetail extends Novel {
  chapters: Chapter[];
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
  novel: (id: number) => request<NovelDetail>(`/api/novels/${id}`),
  createChapter: (novelId: number, title: string) =>
    request<Chapter>(`/api/novels/${novelId}/chapters`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  saveChapter: (id: number, patch: Partial<Chapter>) =>
    request<Chapter>(`/api/chapters/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  deleteChapter: (id: number) =>
    request<void>(`/api/chapters/${id}`, { method: 'DELETE' }),

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
