/* ============================================================
   GEOINTEL — Lógica del renderer (Gemini)
   Funciona dentro de Electron (IPC) y en navegador (fetch directo).
   ============================================================ */

'use strict';

/* ---------- Referencias DOM ---------- */
const $ = (id) => document.getElementById(id);
const topicEl      = $('topic');
const templateEl   = $('template');
const depthEl      = $('depth');
const languageEl   = $('language');
const btnGenerate  = $('btnGenerate');
const genHint      = $('genHint');
const reportEl     = $('report');
const emptyState   = $('emptyState');
const outputStatus = $('outputStatus');
const outputTitle  = $('outputTitle');
const btnCopy      = $('btnCopy');
const btnDownload  = $('btnDownload');
const btnPrint     = $('btnPrint');
const btnClear     = $('btnClear');
const connStatus   = $('connStatus');
const connText     = $('connText');
const toastEl      = $('toast');

const settingsModal = $('settingsModal');
const apiKeyEl      = $('apiKey');
const modelEl       = $('model');
const temperatureEl = $('temperature');

/* ---------- Estado ---------- */
const BRIDGE = window.geointel || null;   // Puente Electron (si existe)
let currentMarkdown = '';
let isGenerating = false;
let activeReqId = null;

const LANG_NAMES = { es: 'español', en: 'inglés', pt: 'portugués', fr: 'francés' };
const DEFAULT_CONFIG = { apiKey: '', model: 'gemini-2.5-flash', temperature: '0.4' };

/* ============================================================
   PLANTILLAS DE PROMPT
   ============================================================ */

const PERSONA = `Actúa como un analista senior de inteligencia geopolítica, historia diplomática y prospectiva estratégica, con más de 25 años de experiencia en análisis de riesgos internacionales.`;

const RIGOR = `Condiciones de rigor (obligatorias):
- Tono analítico, frío, neutral y estrictamente fundamentado en datos verificables.
- Distingue con precisión entre: (a) HECHOS documentados, (b) DECLARACIONES oficiales y (c) ANÁLISIS/INFERENCIA prospectiva.
- Cita fuentes y fechas cuando sea posible (Reuters, AP, AFP, BBC, EFE, Al Jazeera, Financial Times, The Guardian, agencias oficiales, think tanks).
- Evita el sensacionalismo y las teorías conspirativas infundadas; señala explícitamente la incertidumbre.
- No inventes datos: si un dato no es verificable, indícalo como tal.`;

const SECTIONS = {
  full7: `Estructura tu reporte rigurosamente en los siguientes 7 apartados:

1. **Panorama Actual (Hechos Clave en Tiempo Real)**
   - Resume los hechos, combates, maniobras o declaraciones más recientes y verificados por agencias internacionales de primer nivel.
   - Estado exacto de la situación sobre el terreno al día de hoy.

2. **Causas Estructurales y Detonantes Inmediatos**
   - Causas de fondo: disputas territoriales, recursos energéticos o estratégicos, fricciones étnico-religiosas y rivalidades históricas.
   - El detonante: el evento concreto que desató o reavivó la escalada reciente.

3. **Actores Visibles vs. Agendas Ocultas e Intereses de Fondo**
   - Actores directos: gobiernos, líderes y facciones, junto con su narrativa pública oficial.
   - Poderes detrás del tablero: Estados extranjeros, bloques militares, complejos industriales-militares o corporaciones que financian, arman o asesoran a las partes.
   - Evaluación de agenda estratégica: analiza si existe un cálculo geopolítico encubierto (control de corredores logísticos, desdolarización, contención de potencias rivales o distracción de crisis internas). Diferencia hechos de inferencias.

4. **Paralelismos y Precedentes Históricos**
   - Identifica al menos DOS conflictos o crisis históricas del siglo XIX o XX con patrones operativos, diplomáticos o causales similares.
   - Cómo se resolvieron o cómo escalaron.
   - Qué lecciones o advertencias de la historia aplican al escenario actual.

5. **Matriz de Consecuencias (Políticas, Sociales y Financieras)**
   - Políticas: reconfiguración de alianzas, equilibrio de poder, cambios de régimen, polarización, efectividad de organismos multilaterales (ONU, foros regionales).
   - Sociales y humanitarias: desplazamiento forzado, flujos migratorios, crisis de refugiados, impacto en población civil, cohesión social y nacionalismos.
   - Financieras y económicas: volatilidad en bolsas, tasas, divisas y activos refugio (oro, bonos); energía y materias primas; cadenas de suministro, rutas marítimas, sanciones y fragmentación comercial.

6. **Prospectiva y Predicción de Escenarios**
   - Escenario Más Probable (Línea Base): evolución esperada a corto y mediano plazo si persisten las dinámicas actuales.
   - Escenario de Peor Caso (Máxima Escalada): qué error de cálculo o detonante provocaría una conflagración regional/global descontrolada.
   - Escenario de Mejor Caso (Distensión): condiciones, mediadores o concesiones mínimas requeridas para un cese al fuego o solución diplomática.

7. **Conclusión Estratégica**
   - Síntesis de riesgos críticos y puntos de vigilancia permanente para los próximos meses.`,

  full6: `Estructura tu reporte rigurosamente en los siguientes 6 apartados:

1. **Panorama Actual (Hechos Clave en Tiempo Real)** — sucesos y declaraciones recientes verificados; estado de la situación en el terreno.
2. **Causas Raíz y Detonantes Inmediatos** — factores estructurales (territorio, recursos, alineaciones militares, presiones económicas) y el detonante puntual.
3. **Actores Visibles vs. Agendas Ocultas e Intereses de Fondo** — actores primarios y su narrativa pública; poderes detrás del tablero; análisis de agenda estratégica (distinguiendo hechos de inferencias).
4. **Paralelismos y Precedentes Históricos** — al menos dos crisis de los siglos XIX o XX con patrones similares; cómo se resolvieron o escalaron; lecciones aplicables.
5. **Prospectiva y Predicción de Escenarios** — escenario base, peor caso (escalada máxima) y mejor caso (distensión).
6. **Consecuencias Globales** — impacto en la economía mundial, energía y materias primas, seguridad internacional y balance de poder global.`,

  full5: `Estructura tu reporte obligatoriamente en los siguientes 5 apartados:

1. **Panorama Actual (Hechos Clave)** — resumen conciso de los sucesos más críticos recientes, citando hechos concretos comprobados por la prensa internacional.
2. **Causas Raíz y Detonantes** — causas estructurales e históricas (económicas, territoriales, ideológicas, recursos naturales) y el detonante inmediato.
3. **Actores Involucrados e Intereses Tras Bambalinas** — actores directos y sus objetivos explícitos; actores indirectos/poderes detrás (gobiernos externos, corporaciones, bloques militares o alianzas de inteligencia).
4. **Prospectiva y Predicción de Escenarios** — escenario de mayor probabilidad (base), escenario de máxima escalada (peor caso) y escenario de distensión (mejor caso).
5. **Impacto Global** — repercusiones geopolíticas, energéticas, financieras y en cadenas de suministro globales.`
};

function buildPrompt(topic, templateKey, depth, lang) {
  const depthInstr = depth === 'ejecutivo'
    ? 'Elabora un INFORME EJECUTIVO conciso y directo (aprox. 900–1.400 palabras), priorizando lo esencial y las conclusiones accionables.'
    : 'Elabora un DOSSIER EXTENSO Y DETALLADO (mínimo 2.500–4.000 palabras), con desarrollo profundo de cada apartado, datos y matices contrapuestos.';

  const langInstr = `Redacta TODO el informe íntegramente en ${LANG_NAMES[lang] || 'español'}.`;

  return `${PERSONA}

Tu objetivo es realizar una investigación exhaustiva y actualizada sobre el siguiente conflicto, región o acontecimiento mundial:

"""${topic}"""

Debes buscar y contrastar las noticias internacionales MÁS RECIENTES con precedentes históricos documentados.

${SECTIONS[templateKey] || SECTIONS.full7}

${depthInstr}
${langInstr}

${RIGOR}

Comienza directamente con el título del informe y desarrolla cada apartado con encabezados numerados.`;
}

/* ============================================================
   MODO PLANTILLA (sin API key)
   ============================================================ */
function buildTemplateReport(topic, templateKey, depth, lang) {
  const base = {
    full7: [
      ['1. Panorama Actual (Hechos Clave en Tiempo Real)', 'Resume aquí los hechos más recientes verificados por agencias internacionales (Reuters, AP, AFP, BBC, EFE…). Indica fechas y fuentes. Describe el estado exacto de la situación sobre el terreno.'],
      ['2. Causas Estructurales y Detonantes Inmediatos', 'Causas de fondo: disputas territoriales, recursos energéticos/estratégicos, fricciones étnico-religiosas y rivalidades históricas. Detonante: el evento concreto que reavivó la escalada.'],
      ['3. Actores Visibles vs. Agendas Ocultas e Intereses de Fondo', 'Actores directos (gobiernos, líderes, facciones) y su narrativa pública. Poderes detrás del tablero (Estados externos, bloques militares, complejos industriales, corporaciones). Evaluación de agenda estratégica encubierta.'],
      ['4. Paralelismos y Precedentes Históricos', 'Identifica al menos dos crisis de los siglos XIX o XX con patrones similares. Cómo se resolvieron o escalaron. Lecciones aplicables al escenario actual.'],
      ['5. Matriz de Consecuencias (Políticas, Sociales y Financieras)', 'Políticas: alianzas, equilibrio de poder, organismos multilaterales. Sociales: desplazamiento, refugiados, impacto civil. Financieras: mercados, energía, cadenas de suministro.'],
      ['6. Prospectiva y Predicción de Escenarios', 'Escenario base (más probable), peor caso (máxima escalada) y mejor caso (distensión diplomática).'],
      ['7. Conclusión Estratégica', 'Síntesis de riesgos críticos y puntos de vigilancia permanente para los próximos meses.']
    ],
    full6: [
      ['1. Panorama Actual (Hechos Clave en Tiempo Real)', 'Sucesos y declaraciones recientes verificados; estado de la situación.'],
      ['2. Causas Raíz y Detonantes Inmediatos', 'Factores estructurales y el detonante puntual.'],
      ['3. Actores Visibles vs. Agendas Ocultas e Intereses de Fondo', 'Actores primarios, poderes detrás del tablero y agenda estratégica.'],
      ['4. Paralelismos y Precedentes Históricos', 'Al menos dos crisis históricas con patrones similares y sus lecciones.'],
      ['5. Prospectiva y Predicción de Escenarios', 'Escenario base, peor caso y mejor caso.'],
      ['6. Consecuencias Globales', 'Economía mundial, energía, seguridad internacional y balance de poder.']
    ],
    full5: [
      ['1. Panorama Actual (Hechos Clave)', 'Resumen de los sucesos más críticos recientes, con hechos comprobados.'],
      ['2. Causas Raíz y Detonantes', 'Causas estructurales e históricas y el detonante inmediato.'],
      ['3. Actores Involucrados e Intereses Tras Bambalinas', 'Actores directos y poderes detrás.'],
      ['4. Prospectiva y Predicción de Escenarios', 'Escenario base, peor caso y mejor caso.'],
      ['5. Impacto Global', 'Repercusiones geopolíticas, energéticas, financieras y de suministro.']
    ]
  };

  const sections = base[templateKey] || base.full7;
  const depthNote = depth === 'ejecutivo'
    ? '> *Modo ejecutivo: desarrollo breve y directo.*'
    : '> *Modo dossier extenso: desarrollo profundo de cada apartado.*';

  let md = `# Informe de Inteligencia Geopolítica\n\n**Tema analizado:** ${topic}\n\n**Plantilla:** ${templateKey === 'full7' ? '7 apartados' : templateKey === 'full6' ? '6 apartados' : '5 apartados'} · **Idioma:** ${LANG_NAMES[lang] || 'español'}\n\n${depthNote}\n\n---\n\n`;

  sections.forEach(([title, guidance]) => {
    md += `## ${title}\n\n_${guidance}_\n\n_(Completa este apartado con datos verificados, fuentes y análisis.)_\n\n`;
  });

  md += `---\n\n> ⚠️ **Este es el esqueleto generado en MODO PLANTILLA (sin API key).** Para que Gemini redacte el análisis completo, abre ⚙ Configuración, introduce tu API key y vuelve a pulsar "Generar informe".\n`;
  return md;
}

/* ============================================================
   MOTOR DE GENERACIÓN — Gemini
   ============================================================ */

// Vía IPC (Electron)
async function generateViaBridge({ apiKey, model, prompt, temperature }) {
  const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  activeReqId = requestId;

  const res = await BRIDGE.generate({ requestId, apiKey, model, prompt, temperature });
  if (res && res.ok === false) throw new Error(res.error || 'Error desconocido de Gemini');
  return res;
}

// Vía fetch directo (navegador). Gemini permite CORS.
async function generateViaFetch({ apiKey, model, prompt, temperature, signal }) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: PERSONA + ' ' + RIGOR }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.4,
        maxOutputTokens: 8192
      }
    }),
    signal
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
        if (parts) parts.forEach((p) => { if (p.text) { currentMarkdown += p.text; scheduleRender(true); } });
      } catch (e) {}
    }
  }
}

/* ============================================================
   RENDERIZADO
   ============================================================ */
function renderMarkdown(md) {
  if (window.marked && typeof window.marked.parse === 'function') {
    try {
      window.marked.setOptions({ breaks: true, gfm: true });
      return window.marked.parse(md);
    } catch (e) {}
  }
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^/, '<p>').replace(/$/, '</p>');
}

let renderScheduled = false;
function scheduleRender(withCursor) {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    let html = renderMarkdown(currentMarkdown);
    if (withCursor) html += '<span class="typing-cursor"></span>';
    reportEl.innerHTML = html;
  });
}

/* ============================================================
   UI / FLUJO PRINCIPAL
   ============================================================ */
function showToast(msg, type) {
  toastEl.textContent = msg;
  toastEl.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toastEl.className = 'toast'; }, 4200);
}

function setOutputState(state, label) {
  outputStatus.textContent = label;
  outputTitle.classList.toggle('live', state === 'live');
}

function updateConnBadge() {
  const cfg = getConfig();
  if (cfg.apiKey) {
    connStatus.className = 'conn on';
    connText.textContent = 'Gemini · ' + (cfg.model || 'modelo');
    genHint.textContent = 'Listo. Se generará con Gemini (' + (cfg.model || '') + ').';
  } else {
    connStatus.className = 'conn off';
    connText.textContent = 'Modo plantilla';
    genHint.textContent = 'Configura tu API key de Gemini para generar con IA, o usa el modo plantilla.';
  }
}

async function handleGenerate() {
  if (isGenerating) {
    if (BRIDGE && activeReqId) BRIDGE.abort(activeReqId);
    if (window._fetchAbort) window._fetchAbort.abort();
    return;
  }

  const topic = topicEl.value.trim();
  if (!topic) {
    showToast('Escribe primero un conflicto o región.', 'err');
    topicEl.focus();
    return;
  }

  const templateKey = templateEl.value;
  const depth = depthEl.value;
  const lang = languageEl.value;
  const cfg = getConfig();

  currentMarkdown = '';
  emptyState.style.display = 'none';
  reportEl.innerHTML = '';
  btnCopy.disabled = btnDownload.disabled = btnPrint.disabled = btnClear.disabled = true;

  // ---- MODO PLANTILLA ----
  if (!cfg.apiKey) {
    setOutputState('live', 'Generando plantilla…');
    currentMarkdown = buildTemplateReport(topic, templateKey, depth, lang);
    scheduleRender(false);
    setOutputState('done', 'Plantilla generada (sin IA)');
    btnCopy.disabled = btnDownload.disabled = btnPrint.disabled = btnClear.disabled = false;
    showToast('Informe generado en modo plantilla. Añade tu API key de Gemini para el análisis completo.', 'ok');
    return;
  }

  // ---- MODO IA (Gemini) ----
  isGenerating = true;
  btnGenerate.textContent = '■ Detener';
  setOutputState('live', 'Gemini está analizando y redactando…');

  const startTime = Date.now();
  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - startTime) / 1000);
    setOutputState('live', `Analizando… ${s}s · ${currentMarkdown.length} caracteres`);
  }, 500);

  const prompt = buildPrompt(topic, templateKey, depth, lang);

  try {
    if (BRIDGE) {
      await generateViaBridge({
        apiKey: cfg.apiKey, model: cfg.model, prompt, temperature: parseFloat(cfg.temperature)
      });
    } else {
      window._fetchAbort = new AbortController();
      await generateViaFetch({
        apiKey: cfg.apiKey, model: cfg.model, prompt,
        temperature: parseFloat(cfg.temperature), signal: window._fetchAbort.signal
      });
    }
    clearInterval(timer);
    scheduleRender(false);
    if (!currentMarkdown.trim()) throw new Error('El modelo no devolvió contenido. Revisa el modelo o la key.');
    setOutputState('done', 'Informe completado');
    showToast('Informe generado correctamente.', 'ok');
  } catch (err) {
    clearInterval(timer);
    if (err.name === 'AbortError') {
      setOutputState('done', 'Generación detenida');
      showToast('Generación detenida por el usuario.');
    } else {
      setOutputState('error', 'Error de generación');
      showToast('Error: ' + err.message, 'err');
      if (!currentMarkdown) {
        reportEl.innerHTML = `<div class="empty-state"><div class="glyph">⚠</div><h3>No se pudo generar el informe</h3><p>${(err.message || '').replace(/</g, '&lt;')}</p><p style="font-size:13px;color:var(--text-mute)">Comprueba tu API key de Gemini, el modelo y la conexión. También puedes usar el modo plantilla (sin key).</p></div>`;
      }
    }
  } finally {
    isGenerating = false;
    activeReqId = null;
    window._fetchAbort = null;
    btnGenerate.textContent = '▶ Generar informe';
    btnCopy.disabled = btnDownload.disabled = btnPrint.disabled = btnClear.disabled = !currentMarkdown;
  }
}

/* ---------- Exportaciones ---------- */
async function copyReport() {
  if (!currentMarkdown) return;
  try {
    await navigator.clipboard.writeText(currentMarkdown);
    showToast('Informe copiado al portapapeles.', 'ok');
  } catch (e) {
    showToast('No se pudo copiar automáticamente.', 'err');
  }
}

function downloadReport() {
  if (!currentMarkdown) return;
  const topic = topicEl.value.trim().slice(0, 40).replace(/[^\w\-áéíóúñ ]/gi, '').trim().replace(/\s+/g, '_') || 'informe';
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([currentMarkdown], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `GEOINTEL_${topic}_${date}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  showToast('Descargando Markdown…', 'ok');
}

function clearReport() {
  currentMarkdown = '';
  reportEl.innerHTML = '';
  emptyState.style.display = '';
  setOutputState('idle', 'Esperando consulta');
  btnCopy.disabled = btnDownload.disabled = btnPrint.disabled = btnClear.disabled = true;
}

/* ============================================================
   CONFIGURACIÓN
   ============================================================ */
const CFG_KEY = 'geointel_config_v1';

function getConfig() {
  if (BRIDGE && window._cfg) return window._cfg;
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) return Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
  } catch (e) {}
  return Object.assign({}, DEFAULT_CONFIG);
}

function saveConfig(cfg) {
  window._cfg = cfg;
  if (BRIDGE) { BRIDGE.setConfig(cfg); return; }
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
}

function openSettings() {
  const cfg = getConfig();
  apiKeyEl.value = cfg.apiKey || '';
  modelEl.value = cfg.model || DEFAULT_CONFIG.model;
  temperatureEl.value = cfg.temperature || DEFAULT_CONFIG.temperature;
  settingsModal.classList.add('open');
}

function closeSettings() { settingsModal.classList.remove('open'); }

/* ============================================================
   EVENTOS
   ============================================================ */
btnGenerate.addEventListener('click', handleGenerate);

document.querySelectorAll('#examples .chip').forEach((chip) => {
  chip.addEventListener('click', () => { topicEl.value = chip.textContent.trim(); topicEl.focus(); });
});

btnCopy.addEventListener('click', copyReport);
btnDownload.addEventListener('click', downloadReport);
btnPrint.addEventListener('click', () => window.print());
btnClear.addEventListener('click', clearReport);

$('btnSettings').addEventListener('click', openSettings);
$('btnCancelSettings').addEventListener('click', closeSettings);
settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettings(); });

$('toggleKey').addEventListener('click', () => {
  const isPw = apiKeyEl.type === 'password';
  apiKeyEl.type = isPw ? 'text' : 'password';
  $('toggleKey').textContent = isPw ? 'ocultar' : 'ver';
});

$('btnSaveSettings').addEventListener('click', () => {
  const cfg = {
    apiKey: apiKeyEl.value.trim(),
    model: modelEl.value,
    temperature: temperatureEl.value.trim() || DEFAULT_CONFIG.temperature
  };
  saveConfig(cfg);
  updateConnBadge();
  closeSettings();
  showToast(cfg.apiKey ? 'Configuración guardada. Motor: Gemini (' + cfg.model + ')' : 'Modo plantilla activado (sin API key).', 'ok');
});

topicEl.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleGenerate();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });

/* ============================================================
   INIT
   ============================================================ */
async function init() {
  // Clase de plataforma (para el padding de los traffic lights en macOS)
  const platform = BRIDGE ? BRIDGE.platform : 'web';
  document.body.classList.add('platform-' + platform);

  // Suscripción al streaming por IPC (Electron)
  if (BRIDGE) {
    BRIDGE.onChunk(({ requestId, text }) => {
      if (requestId === activeReqId) { currentMarkdown += text; scheduleRender(true); }
    });
    try {
      const stored = await BRIDGE.getConfig();
      window._cfg = Object.assign({}, DEFAULT_CONFIG, stored || {});
    } catch (e) { window._cfg = Object.assign({}, DEFAULT_CONFIG); }
  }

  updateConnBadge();
}

init();
