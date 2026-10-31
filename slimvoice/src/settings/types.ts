export type Mode = 'live' | 'preview' | 'batch';
export type Tempo = 'fast' | 'balanced' | 'best';
export type Level = 'off' | 'punct' | 'light' | 'strong';

export interface Profile {
  match: string;
  level?: Level | 'inherit';
  style?: string;
  translateTo?: string;
}
export interface Settings {
  onboarded: boolean;
  ui: { lang: '' | 'de' | 'en'; theme: 'system' | 'light' | 'dark' };
  hotkey: { toggle: string; cancel: string };
  dictation: {
    mode: Mode;
    tempo: Tempo;
    language: string;
    pauseMs: number;
    sensitivity: number;
    audioProcessing: boolean;
    micId: string;
    maxMinutes: number;
    sounds: boolean;
    overlay: 'bottom' | 'top';
    insert: 'paste' | 'type' | 'copy';
    restoreClipboard: boolean;
    trailingSpace: boolean;
  };
  ai: {
    level: Level;
    style: string;
    removeFillers: boolean;
    voiceCommands: boolean;
    translateTo: string;
    customInstruction: string;
    vocabulary: string[];
    replacements: { from: string; to: string }[];
    profiles: Profile[];
    useContext: boolean;
  };
  services: {
    stt: { provider: string; model: string; fastModel: string; baseUrl: string };
    llm: { provider: string; model: string; baseUrl: string };
    local: { model: LocalKey; device: 'auto' | 'gpu' | 'cpu'; ready: Partial<Record<LocalKey, boolean>> };
  };
  history: { keep: boolean; max: number };
  autostart: boolean;
}
export interface ProviderInfo {
  label: string;
  models: string[];
  main: Record<Tempo, string>;
  preview?: string;
  baseUrl: string;
  keyOptional: boolean;
  keyUrl: string;
}
export type LocalKey = 'base' | 'small' | 'turbo';
export interface EngineStatus {
  downloading: string;
  progress: number;
  loaded: number;
  total: number;
  device: string;
  loadedModel: string;
}
export interface Snapshot {
  local: { models: Record<LocalKey, { id: string; sizeMB: number; ramGB: number }>; status: EngineStatus; ramGB: number; cores: number };
  settings: Settings;
  secrets: { keys: Record<string, { set: boolean; hint: string }>; encrypted: boolean };
  platform: string;
  version: string;
  lang: 'de' | 'en';
  stt: Record<string, ProviderInfo>;
  llm: Record<string, ProviderInfo>;
  hotkeys: { toggle: boolean; cancel: boolean };
  permissions: { mic: string; accessibility: boolean };
  dark: boolean;
}
export interface HistoryItem {
  id: string;
  at: string;
  text: string;
  raw?: string;
  app?: string;
  mode: Mode;
  seconds: number;
}
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };
