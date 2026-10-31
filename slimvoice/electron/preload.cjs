'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = [
  'app:snapshot', 'settings:set', 'secret:set', 'hotkey:check', 'service:test',
  'dictation:toggle', 'dictation:cancel', 'history:list', 'history:remove', 'history:clear',
  'clipboard:write', 'perm:request', 'shell:openExternal', 'app:log',
  'overlay:action', 'rec:segment', 'rec:stopped', 'rec:error',
];

contextBridge.exposeInMainWorld('api', {
  call: (ch, ...args) => {
    if (!CHANNELS.includes(ch)) throw new Error('unknown channel ' + ch);
    return ipcRenderer.invoke(ch, ...args);
  },
  platform: process.platform,
  on(channel, cb) {
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
});
