/**
 * Brücke zur App (Rust). Gleiche Form wie vorher (window.api.call / window.api.on),
 * damit die Oberfläche nicht wissen muss, was dahinter steckt.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const ua = navigator.userAgent;
const platform = /Mac/i.test(ua) ? 'darwin' : /Windows/i.test(ua) ? 'win32' : 'linux';

window.api = {
  call: (ch: string, ...args: unknown[]) => invoke('call', { ch, args }) as Promise<any>,
  on(channel: string, cb: (payload: any) => void) {
    let un: (() => void) | null = null;
    let off = false;
    listen(channel, (e) => cb(e.payload)).then((u) => {
      if (off) u();
      else un = u;
    });
    return () => {
      off = true;
      un?.();
    };
  },
  platform,
};
