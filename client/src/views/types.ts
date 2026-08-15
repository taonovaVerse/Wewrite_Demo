export type ViewId =
  | 'explorer'
  | 'characters'
  | 'world'
  | 'foreshadow'
  | 'style'
  | 'blueprint'
  | 'history'
  | 'assistant';

export interface SidebarView {
  id: ViewId;
  label: string;
  headerTitle: string;
  render(container: HTMLElement): void | Promise<void>;
  headerButton(): void;
}
