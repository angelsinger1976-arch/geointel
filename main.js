'use strict';

/* ============================================================
   GEOINTEL — Proceso principal de Electron
   ============================================================ */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

/* ---------- Fecha actual (para anclar los informes a HOY) ---------- */
const DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function fechaLargaEs(d) {
  return `${DIAS_ES[d.getDay()]}, ${d.getDate()} de ${MESES_ES[d.getMonth()]} de ${d.getFullYear()}`;
}

/* ---------- Persona + rigor del analista (system prompt dinámico) ----------
   La fecha se calcula EN CADA PETICIÓN para que el informe siempre parta del
   día real del sistema y no de datos caducados de años anteriores. */
function buildSystemPrompt() {
  const now = new Date();
  const fecha = fechaLargaEs(now);
  const anio = now.getFullYear();

  return `Actúa como un analista senior de inteligencia geopolítica, historia diplomática y prospectiva estratégica, con más de 25 años de experiencia en análisis de riesgos internacionales.

CONTEXTO TEMPORAL OBLIGATORIO (crítico):
- La FECHA ACTUAL del sistema es ${fecha} (año ${anio}).
- Todo el informe debe describir la situación tal como está HOY, ${fecha}.
- Está TERMINANTEMENTE PROHIBIDO presentar como "actuales" hechos, cifras o acontecimientos de años anteriores (p. ej. 2023, 2024 o 2025).
- La información histórica solo puede usarse etiquetada de forma explícita como contexto o precedente.
- Tienes habilitada la BÚSQUEDA DE GOOGLE en tiempo real: úsala para verificar los hechos más recientes, actualizar cifras y citar fuentes fechadas en ${anio}. No te fíes únicamente de tu memoria interna.
- Si un dato reciente no puede verificarse, indícalo como tal en lugar de inventarlo o reciclar datos antiguos.

Condiciones de rigor (obligatorias):
- Tono analítico, frío, neutral y estrictamente fundamentado en datos verificables.
- Distingue con precisión entre: (a) HECHOS documentados, (b) DECLARACIONES oficiales y (c) ANÁLISIS/INFERENCIA prospectiva.
- Cita fuentes y fechas cuando sea posible (Reuters, AP, AFP, BBC, EFE, Al Jazeera, Financial Times, The Guardian, agencias oficiales, think tanks).
- Evita el sensacionalismo y las teorías conspirativas infundadas; señala explícitamente la incertidumbre.
- No inventes datos: si un dato no es verificable, indícalo como tal.`;
}

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

  // Evitar que un clic en una fuente navegue dentro de la app
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const current = mainWindow.webContents.getURL();
    if (url !== current && /^https?:\/\//i.test(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
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
   IPC — Gemini (streaming + fallback en cadena + grounding)
   ============================================================ */

/* Nota: los parámetros de muestreo temperature/top_p/top_k están
   DEPRECADOS en los modelos Gemini 3.x/4.x y provocan HTTP 400.
   Por eso NO se envían. El control moderno es thinkingLevel.

   Herramientas (tools) según la API GenerateContent (v1beta):
     tools: [ { googleSearch: {}, urlContext: {} } ]
   - googleSearch → "Grounding with Google Search" (búsqueda en vivo).
   - urlContext   → lee el contenido de las URLs incluidas en el prompt.
   La respuesta incluye groundingMetadata con webSearchQueries,
   groundingChunks (fuentes) y urlContextMetadata. */

function buildGenerationConfig(thinkingLevel) {
  const cfg = { maxOutputTokens: 32768 };
  if (thinkingLevel && String(thinkingLevel).toLowerCase() !== 'auto') {
    cfg.thinkingConfig = { thinkingLevel: String(thinkingLevel).toUpperCase() };
  }
  return cfg;
}

/* Construye el array de herramientas a partir de las opciones. */
function buildTools(useSearch, hasUrl) {
  const tools = [];
  if (useSearch) tools.push({ googleSearch: {} });
  if (hasUrl) tools.push({ urlContext: {} });
  return tools;
}

/* Extrae y acumula la metadata de grounding de un chunk SSE. */
function collectGrounding(candidate, grounding) {
  let changed = false;
  if (!candidate) return changed;

  const gm = candidate.groundingMetadata;
  if (gm) {
    if (Array.isArray(gm.webSearchQueries)) {
      for (const q of gm.webSearchQueries) {
        if (q && !grounding.queries.includes(q)) { grounding.queries.push(q); changed = true; }
      }
    }
    if (Array.isArray(gm.groundingChunks)) {
      for (const c of gm.groundingChunks) {
        const web = c && c.web;
        if (web && web.uri && !grounding.sources.some((s) => s.uri === web.uri)) {
          grounding.sources.push({ uri: web.uri, title: web.title || web.uri });
          changed = true;
        }
      }
    }
    if (gm.searchEntryPoint && gm.searchEntryPoint.renderedContent && !grounding.searchWidget) {
      grounding.searchWidget = gm.searchEntryPoint.renderedContent;
      changed = true;
    }
  }

  const ucm = candidate.urlContextMetadata;
  if (ucm && Array.isArray(ucm.urlMetadata)) {
    for (const u of ucm.urlMetadata) {
      const key = (u.retrievedUrl || '') + '|' + (u.urlRetrievalStatus || '');
      if (u.retrievedUrl && !grounding.urls.some((x) => x.key === key)) {
        grounding.urls.push({ key, url: u.retrievedUrl, status: u.urlRetrievalStatus || '' });
        changed = true;
      }
    }
  }
  return changed;
}

/* Realiza UNA petición de streaming a un modelo concreto.
   Devuelve { ok, gotChunks, grounding } o { ok:false, status, error, gotChunks }. */
async function streamModel({ model, apiKey, prompt, thinkingLevel, useSearch, hasUrl, controller, sender, requestId }) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const body = {
    systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: buildGenerationConfig(thinkingLevel)
  };
  const tools = buildTools(useSearch, hasUrl);
  if (tools.length) body.tools = tools;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
  const grounding = { sources: [], queries: [], urls: [], searchWidget: null };

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
        const cand = j.candidates && j.candidates[0];
        const parts = cand && cand.content && cand.content.parts;
        if (parts) {
          for (const p of parts) {
            if (p.text) { sender.send('gemini:chunk', { requestId, text: p.text }); gotChunks = true; }
          }
        }
        // Fuentes / consultas de búsqueda (grounding) en tiempo real
        if (collectGrounding(cand, grounding)) {
          sender.send('gemini:sources', { requestId, grounding });
        }
      } catch (e) { /* fragmento incompleto */ }
    }
  }

  return { ok: true, gotChunks, grounding };
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
      const { model, thinkingLevel, useSearch, hasUrl } = list[i];

      // Informa al renderer del modelo que se está intentando
      sender.send('gemini:model', {
        requestId, model,
        thinkingLevel: thinkingLevel || null,
        useSearch: !!useSearch,
        attempt: i + 1, total: list.length
      });

      let result;
      try {
        result = await streamModel({
          model, apiKey, prompt, thinkingLevel,
          useSearch: !!useSearch, hasUrl: !!hasUrl,
          controller, sender, requestId
        });
      } catch (err) {
        if (err.name === 'AbortError') {
          sender.send('gemini:done', { requestId, aborted: true });
          return { ok: true, aborted: true };
        }
        result = { ok: false, error: err.message, gotChunks: false };
      }

      if (result.ok) {
        sender.send('gemini:sources', { requestId, grounding: result.grounding, final: true });
        sender.send('gemini:done', { requestId, model, grounding: result.grounding });
        return { ok: true, model, grounding: result.grounding };
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
