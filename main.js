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
   IPC — Gemini (streaming + fallback en cadena)
   ============================================================ */

/* Nota: los parámetros de muestreo temperature/top_p/top_k están
   DEPRECADOS en los modelos Gemini 3.x/4.x y provocan HTTP 400.
   Por eso NO se envían. El control moderno es thinkingLevel. */

function buildGenerationConfig(thinkingLevel) {
  const cfg = { maxOutputTokens: 32768 };
  if (thinkingLevel && String(thinkingLevel).toLowerCase() !== 'auto') {
    cfg.thinkingConfig = { thinkingLevel: String(thinkingLevel).toUpperCase() };
  }
  return cfg;
}

/* Realiza UNA petición de streaming a un modelo concreto.
   Devuelve { ok, gotChunks } o { ok:false, status, error, gotChunks }. */
async function streamModel({ model, apiKey, prompt, thinkingLevel, controller, sender, requestId }) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: buildGenerationConfig(thinkingLevel)
    }),
    signal: controller.signal
  });

  if (!res.ok) {
    let t = '';
    try { t = await res.text(); } catch (e) {}
    return { ok: false, status: res.status, error: `Gemini HTTP ${res.status}: ${t.slice(0, 300)}`, gotChunks: false };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let gotChunks = false;

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
            if (p.text) { sender.send('gemini:chunk', { requestId, text: p.text }); gotChunks = true; }
          }
        }
      } catch (e) { /* fragmento incompleto */ }
    }
  }

  return { ok: true, gotChunks };
}

ipcMain.handle('gemini:abort', (_e, { requestId }) => {
  const c = activeRequests.get(requestId);
  if (c) { c.abort(); return true; }
  return false;
});

ipcMain.handle('gemini:generate', async (event, payload) => {
  const { requestId, apiKey, prompt, attempts } = payload;
  const list = Array.isArray(attempts) ? attempts.filter((a) => a && a.model) : [];
  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  const sender = event.sender;
  const errors = [];

  try {
    if (!list.length) throw new Error('No hay modelos configurados para intentar.');

    for (let i = 0; i < list.length; i++) {
      const { model, thinkingLevel } = list[i];

      // Informa al renderer del modelo que se está intentando
      sender.send('gemini:model', {
        requestId, model,
        thinkingLevel: thinkingLevel || null,
        attempt: i + 1, total: list.length
      });

      let result;
      try {
        result = await streamModel({ model, apiKey, prompt, thinkingLevel, controller, sender, requestId });
      } catch (err) {
        if (err.name === 'AbortError') {
          sender.send('gemini:done', { requestId, aborted: true });
          return { ok: true, aborted: true };
        }
        result = { ok: false, error: err.message, gotChunks: false };
      }

      if (result.ok) {
        sender.send('gemini:done', { requestId, model });
        return { ok: true, model };
      }

      errors.push(`${model}: ${result.error}`);

      // Si ya se recibió texto parcial, no reintentamos (evita duplicar salida)
      if (result.gotChunks) {
        sender.send('gemini:error', { requestId, message: result.error, model });
        return { ok: false, error: result.error, model };
      }
      // Si no, se pasa al siguiente modelo de la cadena (fallback)
    }

    const msg = `Ningún modelo pudo completar la solicitud. Detalles: ${errors.join(' | ')}`;
    sender.send('gemini:error', { requestId, message: msg });
    return { ok: false, error: msg };
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
