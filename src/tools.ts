import type { TKey } from './i18n';

export type ToolId =
  | 'structure' | 'rename' | 'images' | 'dates' | 'send' | 'receive' | 'sort' | 'pdf'
  | 'dupes' | 'flatten' | 'empty' | 'size' | 'list';

export type Group = 'folders' | 'files' | 'media' | 'transfer';

export interface ToolDef {
  id: ToolId;
  group: Group;
  /** im Einfach-Modus sichtbar */
  simple: boolean;
  /** passt zu dieser Auswahl? (für Vorschläge nach Rechtsklick) */
  fits: (s: { dirs: number; files: number; images: number; pdfs: number }) => number;
  color: string;
}

export const TOOLS: ToolDef[] = [
  { id: 'structure', group: 'folders', simple: true, color: '#14b8a6', fits: (s) => (s.dirs === 1 && !s.files ? 10 : s.dirs ? 3 : 0) },
  { id: 'rename', group: 'files', simple: true, color: '#6366f1', fits: (s) => (s.files > 1 ? 8 : s.files || s.dirs ? 4 : 0) },
  { id: 'images', group: 'media', simple: true, color: '#f97316', fits: (s) => (s.images ? 9 : s.dirs ? 3 : 0) },
  { id: 'dates', group: 'files', simple: true, color: '#0ea5e9', fits: (s) => (s.images ? 6 : s.files ? 4 : s.dirs ? 2 : 0) },
  { id: 'send', group: 'transfer', simple: true, color: '#22c55e', fits: (s) => (s.files || s.dirs ? 7 : 1) },
  { id: 'receive', group: 'transfer', simple: true, color: '#10b981', fits: (s) => (s.dirs === 1 && !s.files ? 6 : 1) },
  { id: 'pdf', group: 'media', simple: true, color: '#ef4444', fits: (s) => (s.images + s.pdfs > 1 ? 8 : s.pdfs === 1 ? 5 : s.images ? 4 : 0) },
  { id: 'sort', group: 'folders', simple: true, color: '#a855f7', fits: (s) => (s.dirs ? 6 : s.files > 3 ? 3 : 0) },
  { id: 'dupes', group: 'folders', simple: false, color: '#eab308', fits: (s) => (s.dirs ? 4 : s.files > 1 ? 3 : 0) },
  { id: 'size', group: 'folders', simple: false, color: '#64748b', fits: (s) => (s.dirs === 1 ? 4 : 0) },
  { id: 'flatten', group: 'folders', simple: false, color: '#ec4899', fits: (s) => (s.dirs === 1 ? 3 : 0) },
  { id: 'empty', group: 'folders', simple: false, color: '#84cc16', fits: (s) => (s.dirs ? 3 : 0) },
  { id: 'list', group: 'folders', simple: false, color: '#06b6d4', fits: (s) => (s.dirs === 1 ? 3 : 0) },
];

export const GROUPS: Group[] = ['folders', 'files', 'media', 'transfer'];
export const toolName = (id: string) => `tool.${id}` as TKey;
export const toolDesc = (id: string) => `tool.${id}.desc` as TKey;
export const tool = (id: ToolId) => TOOLS.find((x) => x.id === id)!;
