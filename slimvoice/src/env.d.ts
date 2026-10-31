interface SlimVoiceApi {
  call<T = any>(channel: string, ...args: unknown[]): Promise<T>;
  on(channel: string, cb: (payload: any) => void): () => void;
  platform: string;
}
interface Window {
  api: SlimVoiceApi;
}
declare module '*.css';
