export let apiBase = '';

export function apiUrl(path: string): string {
  return apiBase + path;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export async function initApiBase(): Promise<void> {
  if (typeof window === 'undefined' || !window.__TAURI_INTERNALS__) {
    // 浏览器开发流：走 Vite 代理，相对路径即可
    apiBase = '';
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const port = (await invoke('get_backend_port')) as number;
  apiBase = `http://127.0.0.1:${port}`;
}
