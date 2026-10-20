'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const CHANNELS = [
  'settings:get', 'settings:set', 'app:info', 'launch:take',
  'fs:info', 'fs:expand', 'fs:pick', 'fs:reveal', 'fs:open', 'fs:exists', 'fs:trash', 'fs:dirSize',
  'structure:suggest', 'structure:plan', 'structure:apply', 'templates:save', 'templates:remove', 'templates:apply',
  'rename:preview', 'rename:apply', 'dates:preview', 'dates:apply', 'dates:read',
  'images:read', 'images:write', 'images:done', 'images:copyTimes', 'pdf:merge', 'pdf:split',
  'sort:preview', 'sort:apply', 'flatten:preview', 'flatten:apply', 'empty:find', 'dupes:find', 'size:report', 'list:export', 'hash:compute',
  'quick:newfile', 'quick:newfolder', 'quick:copypath',
  'transfer:start', 'transfer:stop', 'transfer:info', 'transfer:setAddress',
  'history:list', 'history:undo', 'history:clear',
  'auto:preview', 'auto:run',
  'menu:status', 'menu:install', 'menu:uninstall', 'menu:openSettings',
  'shell:openExternal', 'clipboard:write', 'win:theme', 'app:log',
];

contextBridge.exposeInMainWorld('api', {
  call: (ch, ...args) => {
    if (!CHANNELS.includes(ch)) throw new Error('unknown channel ' + ch);
    return ipcRenderer.invoke(ch, ...args);
  },
  /** Pfad einer hineingezogenen Datei */
  pathFor: (file) => webUtils.getPathForFile(file),
  platform: process.platform,
  on(channel, cb) {
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
});
