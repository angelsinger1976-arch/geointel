'use strict';

/* ============================================================
   GEOINTEL — Puente seguro (contextBridge)
   Expone una API mínima al renderer sin habilitar Node.
   ============================================================ */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('geointel', {
  isElectron: true,
  platform: process.platform,

  // Configuración persistente (en userData/config.json)
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),

  // Generación con Gemini (streaming)
  generate: (payload) => ipcRenderer.invoke('gemini:generate', payload),
  abort: (requestId) => ipcRenderer.invoke('gemini:abort', { requestId }),

  // Suscripciones a eventos de streaming
  onChunk: (cb) => ipcRenderer.on('gemini:chunk', (_e, d) => cb(d)),
  onModel: (cb) => ipcRenderer.on('gemini:model', (_e, d) => cb(d)),
  onDone: (cb) => ipcRenderer.on('gemini:done', (_e, d) => cb(d)),
  onError: (cb) => ipcRenderer.on('gemini:error', (_e, d) => cb(d))
});
