export type Lang = 'de' | 'en';

export interface Prefs {
  lang: Lang | '';
  theme: 'light' | 'dark' | 'system';
  mode: 'simple' | 'expert';
}

export interface Template {
  id: string;
  name: string;
  dirs: string[];
  at: number;
}

export interface Automation {
  id: string;
  type: 'year' | 'tidy' | 'cleanup';
  enabled: boolean;
  name?: string;
  // year
  parent?: string;
  source?: string;
  month?: number;
  day?: number;
  includeExt?: string[];
  lastYear?: number;
  // tidy / cleanup
  folder?: string;
  by?: 'type' | 'month' | 'year';
  target?: string;
  minAgeSec?: number;
  days?: number;
  lastRun?: number;
}

export interface Settings {
  version: number;
  onboarded: boolean;
  prefs: Prefs;
  menu: { installed: boolean; actions: string[] };
  background: { tray: boolean; autostart: boolean };
  images: { size: string; customBy?: 'px' | 'percent' | 'kb'; maxSide: number; percent: number; format: 'same' | 'jpeg' | 'png' | 'webp'; quality: number; targetKB: number; output: 'folder' | 'next' | 'replace' };
  structure: { includeExt: string[]; step: number };
  transfer: { port: number; inbox: string; address: string };
  templates: Template[];
  automations: Automation[];
}

export interface FileInfo {
  path: string;
  name: string;
  dir: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
  birthtimeMs?: number;
  ext: string;
  kind: 'folder' | 'image' | 'video' | 'audio' | 'doc' | 'archive' | 'app' | 'other';
  rel?: string;
}

export interface HistoryItem {
  id: string;
  at: number;
  tool: string;
  title: string;
  count: number;
  auto: boolean;
  undone: boolean;
  undoable: boolean;
}

export interface AppInfo {
  version: string;
  electron: string;
  platform: string;
  locale: string;
  home: string;
  downloads: string;
  desktop: string;
  pictures: string;
  documents: string;
}

export interface MenuStatus {
  platform: string;
  installed: boolean;
  count?: number;
  sendTo?: boolean;
  unsupported?: boolean;
}

export interface Address {
  name: string;
  address: string;
  kind: string;
}

export interface TransferInfo {
  url: string;
  qr: string;
  address: Address | null;
  addresses: Address[];
  token: string;
  mode: 'send' | 'receive';
  dir: string;
  files: number;
  total: number;
  devices: { ip: string; name: string; at: number }[];
  received: { id: string; name: string; path: string; size: number; device: string }[];
}

export interface Launch {
  action: string;
  paths: string[];
}

export interface Api {
  call<T = any>(channel: string, ...args: unknown[]): Promise<T>;
  pathFor(file: File): string;
  platform: string;
  on(channel: string, cb: (payload: any) => void): () => void;
}
