/* ============================================================
   GEOINTEL — Lógica del renderer (Gemini)
   Funciona dentro de Electron (IPC) y en navegador (fetch directo).
   ============================================================ */

'use strict';

/* ---------- Referencias DOM ---------- */
const $ = (id) => document.getElementById(id);
const topicEl      = $('topic');
const newsUrlEl    = $('newsUrl');
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

const sourcesPanel = $('sourcesPanel');
const sourcesBody  = $('sourcesBody');
const sourcesTitle = $('sourcesTitle');
const searchWidget = $('searchWidget');

const settingsModal = $('settingsModal');
const apiKeyEl      = $('apiKey');
const modelEl       = $('model');
const thinkingLevelEl = $('thinkingLevel');
const useSearchEl   = $('useSearch');

/* ---------- Estado ---------- */
const BRIDGE = window.geointel || null;   // Puente Electron (si existe)
let currentMarkdown = '';
let isGenerating = false;
let activeReqId = null;
let currentModelUsed = '';
let currentGrounding = { sources: [], queries: [], urls: [] };

const LANG_NAMES = { es: 'español', en: 'inglés', pt: 'portugués', fr: 'francés' };
const DEFAULT_CONFIG = { apiKey: '', model: 'gemini-3.8-flash', thinkingLevel: 'auto', useSearch: true };

/* ---------- Fecha actual (ancla temporal de los informes) ---------- */
const DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function fechaActualEs() {
  const d = new Date();
  return `${DIAS_ES[d.getDay()]}, ${d.getDate()} de ${MESES_ES[d.getMonth()]} de ${d.getFullYear()}`;
}
function anioActual() { return new Date().getFullYear(); }

/* Detecta si un texto contiene al menos una URL http(s). */
function extractUrls(text) {
  const m = String(text || '').match(/https?:\/\/[^\s"'<>()]+/gi);
  return m ? m.map((u) => u.replace(/[.,;]+$/, '')) : [];
}


/* Cadena de modelos para el fallback automático (de más a menos capacidad).
   El modelo elegido por el usuario se intenta SIEMPRE primero. */
const MODEL_CHAIN = [
  'gemini-4-argon',
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview'
];

/* Construye la lista ordenada de intentos: el modelo principal primero,
   después el resto de la cadena. Si hay un nivel de razonamiento fijado,
   se añade un intento extra sin él (por si el modelo no lo soporta).
   Si la búsqueda está activada, se añade al final una red de seguridad
   SIN herramientas (por si algún modelo rechazara el uso de tools). */
function buildAttempts(primaryModel, thinkingLevel, useSearch, hasUrl) {
  const chain = [primaryModel, ...MODEL_CHAIN.filter((m) => m !== primaryModel)];
  const attempts = [];
  const useThinking = thinkingLevel && thinkingLevel !== 'auto';
  const search = !!useSearch;

  for (const model of chain) {
    if (useThinking) attempts.push({ model, thinkingLevel, useSearch: search, hasUrl: !!hasUrl });
    attempts.push({ model, thinkingLevel: null, useSearch: search, hasUrl: !!hasUrl });
  }

  // Red de seguridad: reintenta los primeros modelos SIN herramientas.
  if (search) {
    for (const model of chain.slice(0, 3)) {
      attempts.push({ model, thinkingLevel: null, useSearch: false, hasUrl: false });
    }
  }
  return attempts;
}


/* Configuración de generación compatible con los modelos Gemini 3.x/4.x.
   NO se envían temperature/top_p/top_k (deprecados → HTTP 400). */
function buildGenConfig(thinkingLevel) {
  const cfg = { maxOutputTokens: 32768 };
  if (thinkingLevel && String(thinkingLevel).toLowerCase() !== 'auto') {
    cfg.thinkingConfig = { thinkingLevel: String(thinkingLevel).toUpperCase() };
  }
  return cfg;
}

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

function buildPrompt(topic, templateKey, depth, lang, newsUrl, useSearch) {
  const depthInstr = depth === 'ejecutivo'
    ? 'Elabora un INFORME EJECUTIVO conciso y directo (aprox. 900\u20131.400 palabras), priorizando lo esencial y las conclusiones accionables.'
    : 'Elabora un DOSSIER EXTENSO Y DETALLADO (m\u00ednimo 2.500\u20134.000 palabras), con desarrollo profundo de cada apartado, datos y matices contrapuestos.';

  const langInstr = `Redacta TODO el informe \u00edntegramente en ${LANG_NAMES[lang] || 'espa\u00f1ol'}.`;

  // Ancla temporal: obliga a trabajar con la situaci\u00f3n de HOY.
  const fecha = fechaActualEs();
  const anio = anioActual();
  const fechaInstr = `FECHA ACTUAL: hoy es ${fecha} (a\u00f1o ${anio}). Construye el informe sobre la situaci\u00f3n ACTUAL a esta fecha. Prohibido presentar como actuales hechos de a\u00f1os anteriores; cualquier dato hist\u00f3rico debe ir etiquetado como contexto.`;

  // B\u00fasqueda en vivo.
  const searchInstr = useSearch
    ? `B\u00daSQUEDA EN VIVO (obligatoria): usa la herramienta de b\u00fasqueda de Google para localizar y verificar las noticias y hechos M\u00c1S RECIENTES (de las \u00faltimas semanas, en ${anio}). Cita cada fuente con su medio y fecha. Contrasta al menos 3\u20135 fuentes internacionales de primer nivel y descarta informaci\u00f3n desactualizada.`
    : `No tienes b\u00fasqueda web activada: s\u00e9 expl\u00edcito sobre la incertidumbre y evita presentar como actuales datos que no puedas fechar en ${anio}.`;

  // Enlace de noticia aportado por el usuario.
  let newsBlock = '';
  const urls = extractUrls(newsUrl);
  if (urls.length) {
    newsBlock = `\n\nENLACE DE NOTICIA APORTADO POR EL USUARIO (punto de partida):\n${urls.map((u) => `- ${u}`).join('\n')}\n` +
      `Instrucciones sobre el enlace:\n` +
      `1. LEE el contenido de esa(s) URL(s) con la herramienta de contexto de URL (url context).\n` +
      `2. A partir de ella, BUSCA en Google noticias y hechos relacionados M\u00c1S RECIENTES para ampliar, actualizar y verificar la informaci\u00f3n (no te limites a esa noticia).\n` +
      `3. Contrasta el enlace con otras fuentes; se\u00f1ala coincidencias, matices y posibles sesgos o desmentidos.\n` +
      `4. Integra todo ello en el informe, citando el enlace original y las nuevas fuentes encontradas.\n`;
  }

  return `${PERSONA}\n\nTu objetivo es realizar una investigaci\u00f3n exhaustiva y ACTUALIZADA sobre el siguiente conflicto, regi\u00f3n o acontecimiento mundial:\n\n"""${topic}"""\n\n${fechaInstr}\n${searchInstr}${newsBlock}\n\nDebes buscar y contrastar las noticias internacionales M\u00c1S RECIENTES con precedentes hist\u00f3ricos documentados.\n\n${SECTIONS[templateKey] || SECTIONS.full7}\n\n${depthInstr}\n${langInstr}\n\n${RIGOR}\n\nComienza directamente con el t\u00edtulo del informe y desarrolla cada apartado con encabezados numerados.`;
}

/* ============================================================
   MODO PLANTILLA (sin API key)
   ============================================================ */
function buildTemplateReport(topic, templateKey, depth, lang, newsUrl) {
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

  const urls = extractUrls(newsUrl);
  const newsLine = urls.length ? `**Enlace de noticia de partida:** ${urls.join(', ')}\n\n` : '';
  let md = `# Informe de Inteligencia Geopolítica\n\n**Fecha del informe:** ${fechaActualEs()}\n\n**Tema analizado:** ${topic}\n\n${newsLine}**Plantilla:** ${templateKey === 'full7' ? '7 apartados' : templateKey === 'full6' ? '6 apartados' : '5 apartados'} · **Idioma:** ${LANG_NAMES[lang] || 'español'}\n\n${depthNote}\n\n---\n\n`;

  sections.forEach(([title, guidance]) => {
    md += `## ${title}\n\n_${guidance}_\n\n_(Completa este apartado con datos verificados, fuentes y análisis.)_\n\n`;
  });

  md += `---\n\n> ⚠️ **Este es el esqueleto generado en MODO PLANTILLA (sin API key).** Para que Gemini redacte el análisis completo, abre ⚙ Configuración, introduce tu API key y vuelve a pulsar "Generar informe".\n`;
  return md;
}

/* ============================================================
   MOTOR DE GENERACIÓN — Gemini (con fallback en cadena)
   ============================================================ */

// V\u00eda IPC (Electron). El proceso principal gestiona el fallback.
async function generateViaBridge({ apiKey, attempts, prompt }) {
  const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  activeReqId = requestId;

  const res = await BRIDGE.generate({ requestId, apiKey, attempts, prompt });
  if (res && res.ok === false) throw new Error(res.error || 'Error desconocido de Gemini');
  if (res && res.model) currentModelUsed = res.model;
  if (res && res.grounding) { currentGrounding = res.grounding; renderSources(); }
  return res;
}

// Acumula la metadata de grounding de un candidato (fuentes y consultas).
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

// V\u00eda fetch directo (navegador). Gemini permite CORS.
async function generateViaFetch({ apiKey, attempts, prompt, signal }) {
  const errors = [];

  for (let i = 0; i < attempts.length; i++) {
    const { model, thinkingLevel, useSearch, hasUrl } = attempts[i];
    let gotChunks = false;
    const grounding = { sources: [], queries: [], urls: [], searchWidget: null };

    try {
      currentModelUsed = model;
      const tag = useSearch ? ' \u00b7 b\u00fasqueda Google' : '';
      setOutputState('live', `Gemini ${model} \u00b7 intento ${i + 1}/${attempts.length}${tag}\u2026`);

      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/` +
        `${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

      const body = {
        systemInstruction: { parts: [{ text: PERSONA + '\n\n' + RIGOR }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: buildGenConfig(thinkingLevel)
      };
      const tools = [];
      if (useSearch) tools.push({ googleSearch: {} });
      if (hasUrl) tools.push({ urlContext: {} });
      if (tools.length) body.tools = tools;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
            const cand = j.candidates && j.candidates[0];
            const parts = cand && cand.content && cand.content.parts;
            if (parts) parts.forEach((p) => { if (p.text) { currentMarkdown += p.text; gotChunks = true; scheduleRender(true); } });
            if (collectGrounding(cand, grounding)) renderSources();
          } catch (e) {}
        }
      }

      if (gotChunks) { currentGrounding = grounding; renderSources(); return; }   // \u00e9xito con este modelo
      errors.push(`${model}: respuesta vac\u00eda`);  // sin contenido \u2192 siguiente modelo
    } catch (err) {
      if (err.name === 'AbortError') throw err;   // el usuario detuvo \u2192 no reintentar
      if (gotChunks) throw err;                    // ya hay salida parcial \u2192 no duplicar
      errors.push(`${model}: ${err.message}`);      // fallo \u2192 siguiente modelo (fallback)
    }
  }

  throw new Error('Ning\u00fan modelo pudo completar la solicitud. Detalles: ' + errors.join(' | '));
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

/* ---------- Fuentes y búsquedas en vivo ---------- */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }

function renderSources() {
  const g = currentGrounding || {};
  const sources = g.sources || [];
  const queries = g.queries || [];
  const urls = g.urls || [];
  const hasAny = sources.length || queries.length || urls.length;

  if (!hasAny) { sourcesPanel.style.display = 'none'; return; }
  sourcesPanel.style.display = '';

  sourcesTitle.textContent = sources.length
    ? `Fuentes y búsquedas en vivo · ${sources.length} fuente(s)`
    : 'Búsquedas en vivo';

  if (g.searchWidget) {
    searchWidget.style.display = '';
    searchWidget.innerHTML = g.searchWidget;
  }

  let html = '';

  if (queries.length) {
    html += '<div class="src-group"><div class="src-label">Consultas realizadas en Google</div><div class="src-queries">' +
      queries.map((q) => `<span class="src-query">${escapeHtml(q)}</span>`).join('') + '</div></div>';
  }

  if (urls.length) {
    html += '<div class="src-group"><div class="src-label">Enlaces leídos (contexto de URL)</div><ul class="src-list">' +
      urls.map((u) => {
        const ok = /SUCCESS/i.test(u.status || '');
        return `<li><span class="src-badge ${ok ? 'ok' : 'warn'}">${ok ? 'leído' : escapeHtml(u.status || 'n/d')}</span> ` +
          `<a href="${escapeAttr(u.url)}" target="_blank" rel="noopener">${escapeHtml(u.url)}</a></li>`;
      }).join('') + '</ul></div>';
  }

  if (sources.length) {
    html += '<div class="src-group"><div class="src-label">Fuentes web citadas</div><ul class="src-list">' +
      sources.map((s) => `<li><a href="${escapeAttr(s.uri)}" target="_blank" rel="noopener">${escapeHtml(s.title || s.uri)}</a></li>`).join('') +
      '</ul></div>';
  }

  sourcesBody.innerHTML = html;
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
    genHint.textContent = 'Listo. Motor: Gemini (' + (cfg.model || '') + ') con fallback automático.';
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
  const newsUrl = newsUrlEl.value.trim();
  const cfg = getConfig();
  const hasUrl = extractUrls(newsUrl).length > 0;

  currentMarkdown = '';
  currentGrounding = { sources: [], queries: [], urls: [], searchWidget: null };
  renderSources();
  emptyState.style.display = 'none';
  reportEl.innerHTML = '';
  btnCopy.disabled = btnDownload.disabled = btnPrint.disabled = btnClear.disabled = true;

  // ---- MODO PLANTILLA ----
  if (!cfg.apiKey) {
    setOutputState('live', 'Generando plantilla…');
    currentMarkdown = buildTemplateReport(topic, templateKey, depth, lang, newsUrl);
    scheduleRender(false);
    setOutputState('done', 'Plantilla generada (sin IA)');
    btnCopy.disabled = btnDownload.disabled = btnPrint.disabled = btnClear.disabled = false;
    showToast('Informe generado en modo plantilla. Añade tu API key de Gemini para el análisis completo.', 'ok');
    return;
  }

  // ---- MODO IA (Gemini) ----
  isGenerating = true;
  currentModelUsed = cfg.model || DEFAULT_CONFIG.model;
  btnGenerate.textContent = '■ Detener';
  setOutputState('live', 'Gemini está analizando y redactando…');

  const attempts = buildAttempts(cfg.model || DEFAULT_CONFIG.model, cfg.thinkingLevel, cfg.useSearch, hasUrl);

  const startTime = Date.now();
  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - startTime) / 1000);
    const m = currentModelUsed ? `Gemini ${currentModelUsed} · ` : '';
    setOutputState('live', `${m}analizando… ${s}s · ${currentMarkdown.length} caracteres`);
  }, 500);

  const prompt = buildPrompt(topic, templateKey, depth, lang, newsUrl, cfg.useSearch);

  try {
    if (BRIDGE) {
      await generateViaBridge({ apiKey: cfg.apiKey, attempts, prompt });
    } else {
      window._fetchAbort = new AbortController();
      await generateViaFetch({
        apiKey: cfg.apiKey, attempts, prompt, signal: window._fetchAbort.signal
      });
    }
    clearInterval(timer);
    scheduleRender(false);
    if (!currentMarkdown.trim()) throw new Error('El modelo no devolvió contenido. Revisa el modelo o la key.');
    setOutputState('done', 'Informe completado · ' + currentModelUsed);
    showToast('Informe generado con ' + currentModelUsed + '.', 'ok');
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
  currentGrounding = { sources: [], queries: [], urls: [], searchWidget: null };
  reportEl.innerHTML = '';
  searchWidget.innerHTML = '';
  searchWidget.style.display = 'none';
  renderSources();
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
  thinkingLevelEl.value = cfg.thinkingLevel || DEFAULT_CONFIG.thinkingLevel;
  useSearchEl.checked = cfg.useSearch !== false;
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
    thinkingLevel: thinkingLevelEl.value || DEFAULT_CONFIG.thinkingLevel,
    useSearch: useSearchEl.checked
  };
  saveConfig(cfg);
  updateConnBadge();
  closeSettings();
  showToast(cfg.apiKey ? 'Configuración guardada. Motor: Gemini (' + cfg.model + ') con fallback.' : 'Modo plantilla activado (sin API key).', 'ok');
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
    if (BRIDGE.onModel) {
      BRIDGE.onModel(({ requestId, model, attempt, total, useSearch }) => {
        if (requestId === activeReqId) {
          currentModelUsed = model;
          const tag = useSearch ? ' · búsqueda Google' : '';
          setOutputState('live', `Gemini ${model} · intento ${attempt}/${total}${tag} · redactando…`);
        }
      });
    }
    if (BRIDGE.onSources) {
      BRIDGE.onSources(({ requestId, grounding }) => {
        if (requestId === activeReqId && grounding) {
          currentGrounding = grounding;
          renderSources();
        }
      });
    }
    try {
      const stored = await BRIDGE.getConfig();
      window._cfg = Object.assign({}, DEFAULT_CONFIG, stored || {});
    } catch (e) { window._cfg = Object.assign({}, DEFAULT_CONFIG); }
  }

  updateConnBadge();
}

init();
