export type Mode = 'stream' | 'live' | 'preview' | 'batch';
export type Tempo = 'fast' | 'balanced' | 'best';
export type Level = 'off' | 'punct' | 'light' | 'strong';

export interface Profile {
  match: string;
  level?: Level | 'inherit';
  style?: string;
  translateTo?: string;
  vocabulary?: string[];
  replacements?: { from: string; to: string }[];
  customInstruction?: string;
}
export interface Settings {
  onboarded: boolean;
  wizardStep: number;
  seenApps: string[];
  ui: { lang: '' | 'de' | 'en'; theme: 'system' | 'light' | 'dark'; mode: 'simple' | 'expert' };
  hotkey: { toggle: string; cancel: string; hold: string; command: string };
  dictation: {
    mode: Mode;
    tempo: Tempo;
    language: string;
    pauseMs: number;
    sensitivity: number;
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
    local: { model: LocalKey; gpu: boolean; keepLoadedMin: number };
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
}
export interface Snapshot {
  local: {
    models: Record<LocalKey, { sizeMB: number; ramGB: number }>;
    downloaded: Partial<Record<LocalKey, number>>;
    status: EngineStatus;
    cores: number;
    gpu: boolean;
    appleSilicon: boolean;
    loaded: { model: string; gpu: boolean } | null;
  };
  website: string;
  email: string;
  recording: boolean;
  settings: Settings;
  secrets: { keys: Record<string, { set: boolean; hint: string }>; encrypted: boolean };
  platform: string;
  version: string;
  lang: 'de' | 'en';
  stt: Record<string, ProviderInfo>;
  llm: Record<string, ProviderInfo>;
  hotkeys: { toggle: boolean; cancel: boolean; command?: boolean };
  permissions: { mic: string; accessibility: boolean };
}
export interface HistoryItem {
  id: string;
  at: string;
  text: string;
  raw?: string;
  app?: string;
  mode: Mode | 'command';
  seconds: number;
}
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };
