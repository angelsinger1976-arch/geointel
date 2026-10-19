'use strict';

/* ============================================================
   GEOINTEL — Proceso principal de Electron
   ============================================================ */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

/* ---------- Persona + rigor del analista (system prompt) ---------- */
const SYSTEM_PROMPT = `Actúa como un analista senior de inteligencia geopolítica, historia diplomática y prospectiva estratégica, con más de 25 años de experiencia en análisis de riesgos internacionales.

Condiciones de rigor (obligatorias):
- Tono analítico, frío, neutral y estrictamente fundamentado en datos verificables.
- Distingue con precisión entre: (a) HECHOS documentados, (b) DECLARACIONES oficiales y (c) ANÁLISIS/INFERENCIA prospectiva.
- Cita fuentes y fechas cuando sea posible (Reuters, AP, AFP, BBC, EFE, Al Jazeera, Financial Times, The Guardian, agencias oficiales, think tanks).
- Evita el sensacionalismo y las teorías conspirativas infundadas; señala explícitamente la incertidumbre.
- No inventes datos: si un dato no es verificable, indícalo como tal.`;

let mainWindow = null;
const activeRequests = new Map();

/* ---------- Persistencia de configuración ---------- */
function configFile() {
  return path.join(app.getPath('userData'), 'config.json');
}
function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch (e) { return {}; }
}
function writeConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch (e) { return false; }
}

/* ---------- Ventana principal ---------- */
function createWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 880,
    minWidth: 760,
    minHeight: 620,
    backgroundColor: '#060a12',
    title: 'GEOINTEL',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 18, y: 22 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Abrir enlaces externos en el navegador del sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ============================================================
   IPC — Configuración
   ============================================================ */
ipcMain.handle('config:get', () => readConfig());
ipcMain.handle('config:set', (_e, cfg) => writeConfig(cfg));

/* ============================================================
   IPC — Gemini (streaming)
   ============================================================ */
ipcMain.handle('gemini:abort', (_e, { requestId }) => {
  const c = activeRequests.get(requestId);
  if (c) { c.abort(); return true; }
  return false;
});

ipcMain.handle('gemini:generate', async (event, payload) => {
  const { requestId, apiKey, model, prompt, temperature } = payload;
  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  const sender = event.sender;

  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.4,
          maxOutputTokens: 8192
        }
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      let t = '';
      try { t = await res.text(); } catch (e) {}
      throw new Error(`Gemini HTTP ${res.status}: ${t.slice(0, 300)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        let line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const parts = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
          if (parts) {
            for (const p of parts) {
              if (p.text) sender.send('gemini:chunk', { requestId, text: p.text });
            }
          }
        } catch (e) { /* fragmento incompleto */ }
      }
    }

    sender.send('gemini:done', { requestId });
    return { ok: true };
  } catch (err) {
    if (err.name === 'AbortError') {
      sender.send('gemini:done', { requestId, aborted: true });
      return { ok: true, aborted: true };
    }
    sender.send('gemini:error', { requestId, message: err.message });
    return { ok: false, error: err.message };
  } finally {
    activeRequests.delete(requestId);
  }
});
