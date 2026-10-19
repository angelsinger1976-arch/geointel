/* ============================================================
   Geo Intel by TheFirm — Lógica del renderer (Gemini)
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

const worldNewsKeyEl = $('worldNewsKey');
const useNewsEl      = $('useNews');
const newsCountEl    = $('newsCount');
const newsLangEl     = $('newsLang');

/* ---------- Estado ---------- */
const BRIDGE = window.geointel || null;   // Puente Electron (si existe)
const GeoNews = window.GeoNews || {};     // Utilidades de noticias (news-util.js)
let currentMarkdown = '';
let isGenerating = false;
let activeReqId = null;
let currentModelUsed = '';
let currentGrounding = { sources: [], queries: [], urls: [] };
let currentMeta = null;        // metadatos geográficos del informe (bloque geointel-meta)
let currentLocation = null;    // { name, lat, lng, points[] } para el mapa
let currentImages = [];        // fotos extraídas de las fuentes
let currentNews = [];          // noticias reales (World News API)
let currentNewsQuery = '';     // consulta usada en la búsqueda de noticias
let mapInstance = null;        // instancia de Leaflet

const LANG_NAMES = { es: 'español', en: 'inglés', pt: 'portugués', fr: 'francés' };
const DEFAULT_CONFIG = {
  apiKey: '',
  model: 'gemini-3.8-flash',
  thinkingLevel: 'auto',
  useSearch: true,
  worldNewsKey: '',
  useNews: true,
  newsCount: 40,
  newsLang: ''
};

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
   NOTICIAS REALES (World News API)
   ============================================================ */

const MESES_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/* Fecha legible de una noticia ("2026-10-19 16:31:38" → "19 oct 2026 · 16:31"). */
function formatNewsDate(s) {
  const t = GeoNews.ts ? GeoNews.ts(s) : Date.parse(s);
  if (!t || !isFinite(t)) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MESES_ABBR[d.getMonth()]} ${d.getFullYear()} · ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* Busca noticias reales y recientes sobre el tema (vía IPC o fetch directo). */
async function searchNews(topic, lang, cfg) {
  const query = (GeoNews.buildQuery ? GeoNews.buildQuery(topic) : String(topic || ''));
  const number = parseInt(cfg.newsCount, 10) || 40;
  const language = cfg.newsLang || '';
  let res = null;

  try {
    if (BRIDGE && BRIDGE.searchNews) {
      res = await BRIDGE.searchNews({ apiKey: cfg.worldNewsKey, query, language, number });
    } else {
      const params = new URLSearchParams();
      if (query) params.set('text', query);
      if (language) params.set('language', language);
      params.set('number', String(number));
      params.set('sort', 'publish-time');
      params.set('sort-direction', 'DESC');
      const r = await fetch('https://api.worldnewsapi.com/search-news?' + params.toString(), {
        headers: { 'x-api-key': cfg.worldNewsKey, 'Accept': 'application/json' }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const items = (data.news || [])
        .map((n) => (GeoNews.normalizeItem ? GeoNews.normalizeItem(n) : n)).filter(Boolean);
      res = { ok: true, available: data.available || 0, news: items };
    }
  } catch (e) {
    res = { ok: false, error: e.message };
  }

  if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'error', query };

  const kws = GeoNews.keywords ? GeoNews.keywords(topic) : [];
  const ranked = GeoNews.rank ? GeoNews.rank(res.news || [], kws, 12) : (res.news || []).slice(0, 12);
  return { ok: true, query, available: res.available || 0, total: (res.news || []).length, news: ranked };
}

/* Tarjeta HTML de una noticia. */
function newsCardHtml(n) {
  const medio = hostOf(n.url);
  const fecha = formatNewsDate(n.publishDate);
  const s = GeoNews.sentimentLabel ? GeoNews.sentimentLabel(n.sentiment) : null;
  const sent = s ? `<span class="rx-sent ${s.cls}" title="sentimiento ${n.sentiment}">${s.label}</span>` : '';
  const img = n.image
    ? `<a class="rx-news-thumb" href="${escapeAttr(n.url)}" target="_blank" rel="noopener"><img src="${escapeAttr(n.image)}" alt="" loading="lazy" onerror="this.closest('.rx-news-thumb').style.display='none'" /></a>`
    : '';
  const raw = (n.summary || n.text || '').replace(/\s+/g, ' ').trim();
  const resumen = raw.slice(0, 240) + (raw.length > 240 ? '…' : '');
  return `<article class="rx-news-card${n.image ? ' has-img' : ''}">${img}` +
    `<div class="rx-news-body">` +
    `<div class="rx-news-meta"><span class="rx-news-src">${escapeHtml(medio)}</span>` +
    (fecha ? ` · <time>${escapeHtml(fecha)}</time>` : '') + ` ${sent}</div>` +
    `<h3 class="rx-news-title"><a href="${escapeAttr(n.url)}" target="_blank" rel="noopener">${escapeHtml(n.title || medio)}</a></h3>` +
    (resumen ? `<p class="rx-news-sum">${escapeHtml(resumen)}</p>` : '') +
    `</div></article>`;
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

function buildPrompt(topic, templateKey, depth, lang, newsUrl, useSearch, newsItems) {
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

  // Noticias reales recuperadas de la World News API (contexto factual fechado).
  let newsFeed = '';
  if (Array.isArray(newsItems) && newsItems.length) {
    const lines = newsItems.slice(0, 12).map((n, i) => {
      const medio = hostOf(n.url);
      const fecha = (n.publishDate || '').slice(0, 16);
      const resumen = (n.summary || n.text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      return `${i + 1}. "${n.title}" — ${medio}${fecha ? ' (' + fecha + ')' : ''}\n   ${resumen}\n   URL: ${n.url}`;
    });
    newsFeed = `\n\nNOTICIAS REALES RECIENTES (recuperadas de la World News API para este análisis; úsalas como base factual y cítalas con su medio y fecha):\n${lines.join('\n')}\n\n` +
      `Instrucciones sobre estas noticias:\n` +
      `1. Úsalas como punto de partida FACTUAL y fechado; intégralas en el "Panorama Actual".\n` +
      `2. Amplíalas y verifícalas con la búsqueda de Google y, si procede, con el enlace aportado.\n` +
      `3. Cita cada noticia por su medio y fecha; si alguna parece sesgada o desactualizada, señálalo.\n` +
      `4. No inventes datos que no aparezcan en estas noticias ni en tus búsquedas.\n`;
  }

  // Bloque de metadatos geográficos (para el mapa del informe).
  const metaInstr = `\n\nMETADATOS GEOGRÁFICOS (obligatorio): al FINAL del informe, después de la conclusión, añade un ÚNICO bloque de código con el lenguaje geointel-meta que contenga EXACTAMENTE un objeto JSON con esta forma:\n\`\`\`geointel-meta\n{"ubicacion":{"nombre":"<lugar central del análisis>","lat":<latitud>,"lng":<longitud>},"puntos":[{"nombre":"<lugar clave>","lat":<latitud>,"lng":<longitud>}]}\n\`\`\`\n- "ubicacion": el lugar central del análisis, con coordenadas decimales reales (WGS84).\n- "puntos": hasta 5 ubicaciones clave mencionadas en el informe (opcional; puede ir vacío).\n- No escribas ningún otro texto dentro del bloque de código.`;

  return `${PERSONA}\n\nTu objetivo es realizar una investigaci\u00f3n exhaustiva y ACTUALIZADA sobre el siguiente conflicto, regi\u00f3n o acontecimiento mundial:\n\n"""${topic}"""\n\n${fechaInstr}\n${searchInstr}${newsBlock}${newsFeed}\n\nDebes buscar y contrastar las noticias internacionales M\u00c1S RECIENTES con precedentes hist\u00f3ricos documentados.\n\n${SECTIONS[templateKey] || SECTIONS.full7}\n\n${depthInstr}\n${langInstr}\n\n${RIGOR}\n\nComienza directamente con el t\u00edtulo del informe y desarrolla cada apartado con encabezados numerados.${metaInstr}`;
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
   EXTRAS DEL INFORME: mapa de ubicación + fotos + fuentes
   ============================================================ */

/* Dominio legible de una URL. */
function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return String(u || ''); }
}

/* Extrae y elimina el bloque de metadatos geográficos (geointel-meta). */
function parseMetaBlock(md) {
  const text = String(md || '');
  let match = text.match(/```geointel-meta\s*([\s\S]*?)```/i);
  let inner = match ? match[1] : null;
  let full = match ? match[0] : null;

  if (!inner) {
    const re = /```(?:json)?\s*([\s\S]*?)```/gi;
    let m;
    while ((m = re.exec(text))) {
      const body = m[1];
      if (/["']?ubicacion["']?\s*:/i.test(body) || /["']?lat["']?\s*:/.test(body)) {
        inner = body; full = m[0]; break;
      }
    }
  }
  if (!inner) return { meta: null, cleaned: text };

  let meta = null;
  try { meta = JSON.parse(inner.trim()); } catch (e) { meta = null; }
  if (!meta || typeof meta !== 'object') return { meta: null, cleaned: text };

  const cleaned = full ? text.replace(full, '').replace(/\n{3,}$/, '\n').replace(/\s+$/, '') : text;
  return { meta, cleaned };
}

/* Quita el bloque de metadatos del markdown mostrado y lo guarda. */
function stripMeta() {
  const { meta, cleaned } = parseMetaBlock(currentMarkdown);
  currentMeta = meta || null;
  if (meta) currentMarkdown = cleaned;
}

/* Normaliza la lista de puntos geográficos. */
function normalizePoints(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((p) => ({ nombre: p && (p.nombre || p.name), lat: Number(p && p.lat), lng: Number(p && p.lng) }))
    .filter((p) => isFinite(p.lat) && isFinite(p.lng));
}

/* Lista unificada y sin duplicados de las fuentes del informe. */
function buildSourceItems() {
  const items = [];
  const seen = new Set();
  const add = (url, title, kind) => {
    if (!url || !/^https?:\/\//i.test(url)) return;
    const key = url.replace(/#.*$/, '').replace(/\/$/, '');
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ url, title: (title && String(title).trim()) || hostOf(url), kind });
  };
  const g = currentGrounding || {};
  (g.urls || []).forEach((u) => add(u.url, hostOf(u.url), 'read'));
  (g.sources || []).forEach((s) => add(s.uri, s.title, 'web'));
  return items;
}

/* URLs de las fuentes (para extraer fotos). */
function collectSourceUrls() {
  const g = currentGrounding || {};
  const urls = [];
  (g.urls || []).forEach((u) => { if (u.url) urls.push(u.url); });
  (g.sources || []).forEach((s) => { if (s.uri) urls.push(s.uri); });
  (currentNews || []).forEach((n) => { if (n.url) urls.push(n.url); });
  return [...new Set(urls.map((u) => u.replace(/#.*$/, '')))];
}

/* Dibuja el mapa (Leaflet) con el marcador principal y los puntos clave. */
function renderMap(loc) {
  const el = document.getElementById('geoMap');
  if (!el) return;
  if (!window.L || typeof window.L.map !== 'function') {
    el.innerHTML = '<div class="rx-map-fallback">Mapa no disponible (Leaflet no cargado).</div>';
    return;
  }
  try {
    if (mapInstance) { try { mapInstance.remove(); } catch (e) {} mapInstance = null; }
    const map = window.L.map(el, { scrollWheelZoom: false, zoomControl: true }).setView([loc.lat, loc.lng], 5);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);

    const mainIcon = window.L.divIcon({ className: 'geo-pin', html: '<span></span>', iconSize: [24, 24], iconAnchor: [12, 12] });
    window.L.marker([loc.lat, loc.lng], { icon: mainIcon }).addTo(map)
      .bindPopup('<strong>' + escapeHtml(loc.name || 'Ubicación') + '</strong>');

    const pts = Array.isArray(loc.points) ? loc.points : [];
    const altIcon = window.L.divIcon({ className: 'geo-pin geo-pin-alt', html: '<span></span>', iconSize: [16, 16], iconAnchor: [8, 8] });
    const bounds = [[loc.lat, loc.lng]];
    pts.forEach((p) => {
      const la = Number(p.lat), ln = Number(p.lng);
      if (!isFinite(la) || !isFinite(ln)) return;
      window.L.marker([la, ln], { icon: altIcon }).addTo(map).bindPopup(escapeHtml(p.nombre || ''));
      bounds.push([la, ln]);
    });
    if (bounds.length > 1) { try { map.fitBounds(bounds, { padding: [40, 40], maxZoom: 7 }); } catch (e) {} }

    mapInstance = map;
    setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 320);
  } catch (e) {
    el.innerHTML = '<div class="rx-map-fallback">No se pudo dibujar el mapa.</div>';
  }
}

/* Construye y muestra la sección de extras (mapa + fotos + fuentes). */
function renderReportExtras() {
  if (!reportExtras) return;
  const items = buildSourceItems();
  const queries = (currentGrounding && currentGrounding.queries) || [];
  const loc = currentLocation;
  const imgs = currentImages || [];
  const news = currentNews || [];

  const hasLoc = loc && isFinite(loc.lat) && isFinite(loc.lng);
  const hasSources = items.length || queries.length;
  const hasImgs = imgs.length;
  const hasNews = news.length > 0;

  if (!hasLoc && !hasSources && !hasImgs && !hasNews) {
    reportExtras.style.display = 'none';
    reportExtras.innerHTML = '';
    return;
  }
  reportExtras.style.display = '';

  let html = '';

  if (hasNews) {
    const q = currentNewsQuery ? ` · consulta: \u201c${escapeHtml(currentNewsQuery)}\u201d` : '';
    html += '<section class="rx-section rx-news-sec">' +
      '<h2 class="rx-title"><span class="rx-ico">\uD83D\uDCF0</span> Noticias recientes (World News API)</h2>' +
      '<p class="rx-sub">Últimos titulares recuperados para este análisis' + q + ' · ' + news.length + ' noticia(s).</p>' +
      '<div class="rx-news-grid">' + news.map(newsCardHtml).join('') + '</div>' +
      '</section>';
  }

  if (hasLoc) {
    html += '<section class="rx-section rx-map-sec">' +
      '<h2 class="rx-title"><span class="rx-ico">\uD83D\uDCCD</span> Ubicaci\u00f3n geogr\u00e1fica</h2>' +
      '<div class="rx-map-wrap"><div id="geoMap" class="geo-map"></div>' +
      '<div class="rx-map-meta"><strong>' + escapeHtml(loc.name || 'Ubicaci\u00f3n del an\u00e1lisis') + '</strong>' +
      '<span class="rx-coords">' + loc.lat.toFixed(4) + ', ' + loc.lng.toFixed(4) + '</span>' +
      '<a class="rx-osm-link" href="https://www.openstreetmap.org/?mlat=' + loc.lat + '&mlon=' + loc.lng + '#map=6/' + loc.lat + '/' + loc.lng + '" target="_blank" rel="noopener">Ver en OpenStreetMap</a>' +
      '</div></div></section>';
  }

  if (hasImgs) {
    html += '<section class="rx-section rx-photos-sec">' +
      '<h2 class="rx-title"><span class="rx-ico">\uD83D\uDDBC\uFE0F</span> Fotograf\u00edas de las fuentes</h2>' +
      '<div class="rx-gallery">' +
      imgs.map((im) => '<figure class="rx-photo"><img src="' + im.image + '" alt="' + escapeAttr(im.title || 'foto') + '" loading="lazy" />' +
        '<figcaption><a href="' + escapeAttr(im.page) + '" target="_blank" rel="noopener">' + escapeHtml(im.title || hostOf(im.page)) + '</a></figcaption></figure>').join('') +
      '</div></section>';
  }

  if (hasSources) {
    html += '<section class="rx-section rx-sources-sec">' +
      '<h2 class="rx-title"><span class="rx-ico">\uD83D\uDD17</span> Fuentes y referencias</h2>' +
      '<p class="rx-sub">Noticias, documentos y fuentes en que se bas\u00f3 este informe.</p>';
    if (items.length) {
      html += '<ol class="rx-refs">' + items.map((it) => {
        const badge = it.kind === 'read' ? '<span class="rx-badge">le\u00eddo</span>' : '';
        return '<li>' + badge + '<a href="' + escapeAttr(it.url) + '" target="_blank" rel="noopener">' + escapeHtml(it.title) + '</a> ' +
          '<span class="rx-url">' + escapeHtml(it.url) + '</span></li>';
      }).join('') + '</ol>';
    }
    if (queries.length) {
      html += '<div class="rx-queries"><span class="rx-q-label">B\u00fasquedas realizadas en Google:</span> ' +
        queries.map((q) => '<span class="rx-query">' + escapeHtml(q) + '</span>').join(' ') + '</div>';
    }
    html += '</section>';
  }

  reportExtras.innerHTML = html;
  if (hasLoc) renderMap(loc);
}

/* Geocodifica un nombre de lugar (vía IPC en Electron; fetch en navegador). */
async function geocodeLocation(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  try {
    if (BRIDGE && BRIDGE.geocode) {
      const r = await BRIDGE.geocode(q);
      if (r && r.ok && isFinite(r.lat) && isFinite(r.lng)) return { name: r.name || q, lat: r.lat, lng: r.lng, points: [] };
      return null;
    }
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(q.slice(0, 240));
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || !arr.length) return null;
    return { name: arr[0].display_name || q, lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon), points: [] };
  } catch (e) { return null; }
}

/* Descarga las fotos (og:image) de las fuentes. */
async function fetchSourceImages(urls) {
  const list = (urls || []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 8);
  if (!list.length) return [];
  try {
    if (BRIDGE && BRIDGE.fetchImages) {
      const r = await BRIDGE.fetchImages(list);
      return (r && Array.isArray(r.images)) ? r.images : [];
    }
  } catch (e) {}
  return [];
}

/* Tras generar el informe: resuelve la ubicación y las fotos. */
async function finalizeExtras(topic) {
  try {
    let loc = null;
    const u = currentMeta && currentMeta.ubicacion;
    if (u && isFinite(Number(u.lat)) && isFinite(Number(u.lng))) {
      loc = { name: u.nombre || topic, lat: Number(u.lat), lng: Number(u.lng), points: normalizePoints(currentMeta.puntos) };
    } else {
      loc = await geocodeLocation((u && u.nombre) || topic);
    }
    currentLocation = loc;
    renderReportExtras();

    // Fotos: se prefieren las imágenes de las noticias reales; si no hay,
    // se extrae la og:image de las fuentes citadas.
    const newsImgs = (currentNews || []).filter((n) => n.image).slice(0, 6)
      .map((n) => ({ page: n.url, image: n.image, title: hostOf(n.url) }));
    if (newsImgs.length) {
      currentImages = newsImgs;
      renderReportExtras();
    } else {
      const urls = collectSourceUrls();
      if (urls.length) {
        const imgs = await fetchSourceImages(urls);
        if (imgs.length) { currentImages = imgs; renderReportExtras(); }
      }
    }
  } catch (e) { /* los extras son opcionales */ }
}

/* Markdown completo (informe + extras) para copiar/descargar. */
function buildFullMarkdown() {
  let md = currentMarkdown || '';
  const items = buildSourceItems();
  const queries = (currentGrounding && currentGrounding.queries) || [];
  const loc = currentLocation;
  const imgs = currentImages || [];

  if (loc && isFinite(loc.lat) && isFinite(loc.lng)) {
    md += '\n\n---\n\n## \uD83D\uDCCD Ubicaci\u00f3n geogr\u00e1fica\n\n**' + (loc.name || 'Ubicaci\u00f3n del an\u00e1lisis') + '** \u2014 ' +
      loc.lat.toFixed(4) + ', ' + loc.lng.toFixed(4) + '\n\n[Ver en OpenStreetMap](https://www.openstreetmap.org/?mlat=' + loc.lat + '&mlon=' + loc.lng + '#map=6/' + loc.lat + '/' + loc.lng + ')\n';
  }
  if (currentNews && currentNews.length) {
    md += '\n\n## \uD83D\uDCF0 Noticias recientes (World News API)\n\n';
    currentNews.forEach((n) => {
      const medio = hostOf(n.url);
      const fecha = (n.publishDate || '').slice(0, 10);
      md += '- **[' + (n.title || medio) + '](' + n.url + ')** \u2014 ' + medio + (fecha ? ' (' + fecha + ')' : '') + '\n';
    });
  }
  if (imgs.length) {
    md += '\n\n## \uD83D\uDDBC\uFE0F Fotograf\u00edas de las fuentes\n\n';
    imgs.forEach((im) => { md += '- [' + (im.title || hostOf(im.page)) + '](' + im.page + ')\n'; });
  }
  if (items.length || queries.length) {
    md += '\n\n## \uD83D\uDD17 Fuentes y referencias\n\n';
    items.forEach((it, i) => { md += (i + 1) + '. [' + it.title + '](' + it.url + ')\n'; });
    if (queries.length) md += '\n**B\u00fasquedas realizadas en Google:** ' + queries.join(' \u00b7 ') + '\n';
  }
  return md;
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
  currentMeta = null;
  currentLocation = null;
  currentImages = [];
  currentNews = [];
  currentNewsQuery = '';
  if (mapInstance) { try { mapInstance.remove(); } catch (e) {} mapInstance = null; }
  if (reportExtras) { reportExtras.style.display = 'none'; reportExtras.innerHTML = ''; }
  renderSources();
  emptyState.style.display = 'none';
  reportEl.innerHTML = '';
  btnCopy.disabled = btnDownload.disabled = btnPrint.disabled = btnClear.disabled = true;

  // ---- NOTICIAS REALES (World News API) ----
  if (cfg.useNews && cfg.worldNewsKey) {
    setOutputState('live', 'Buscando noticias recientes\u2026');
    try {
      const nr = await searchNews(topic, lang, cfg);
      if (nr.ok) {
        currentNews = nr.news || [];
        currentNewsQuery = nr.query || '';
        if (currentNews.length) renderReportExtras();
      } else {
        showToast('World News API: ' + (nr.error || 'sin resultados'), 'err');
      }
    } catch (e) { /* la búsqueda de noticias es opcional */ }
  }

  // ---- MODO PLANTILLA ----
  if (!cfg.apiKey) {
    setOutputState('live', 'Generando plantilla…');
    currentMarkdown = buildTemplateReport(topic, templateKey, depth, lang, newsUrl);
    scheduleRender(false);
    setOutputState('done', 'Plantilla generada (sin IA)');
    btnCopy.disabled = btnDownload.disabled = btnPrint.disabled = btnClear.disabled = false;
    showToast('Informe generado en modo plantilla. Añade tu API key de Gemini para el análisis completo.', 'ok');
    finalizeExtras(topic);
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

  const prompt = buildPrompt(topic, templateKey, depth, lang, newsUrl, cfg.useSearch, currentNews);

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
    stripMeta();
    scheduleRender(false);
    if (!currentMarkdown.trim()) throw new Error('El modelo no devolvió contenido. Revisa el modelo o la key.');
    setOutputState('done', 'Informe completado · ' + currentModelUsed);
    showToast('Informe generado con ' + currentModelUsed + '.', 'ok');
    finalizeExtras(topic);
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
    await navigator.clipboard.writeText(buildFullMarkdown());
    showToast('Informe copiado al portapapeles.', 'ok');
  } catch (e) {
    showToast('No se pudo copiar automáticamente.', 'err');
  }
}

function downloadReport() {
  if (!currentMarkdown) return;
  const topic = topicEl.value.trim().slice(0, 40).replace(/[^\w\-áéíóúñ ]/gi, '').trim().replace(/\s+/g, '_') || 'informe';
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([buildFullMarkdown()], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `GeoIntelByTheFirm_${topic}_${date}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  showToast('Descargando Markdown…', 'ok');
}

function clearReport() {
  currentMarkdown = '';
  currentGrounding = { sources: [], queries: [], urls: [], searchWidget: null };
  currentMeta = null;
  currentLocation = null;
  currentImages = [];
  currentNews = [];
  currentNewsQuery = '';
  if (mapInstance) { try { mapInstance.remove(); } catch (e) {} mapInstance = null; }
  if (reportExtras) { reportExtras.style.display = 'none'; reportExtras.innerHTML = ''; }
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
  worldNewsKeyEl.value = cfg.worldNewsKey || '';
  useNewsEl.checked = cfg.useNews !== false;
  newsCountEl.value = String(cfg.newsCount || DEFAULT_CONFIG.newsCount);
  newsLangEl.value = cfg.newsLang || '';
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

$('toggleNewsKey').addEventListener('click', () => {
  const isPw = worldNewsKeyEl.type === 'password';
  worldNewsKeyEl.type = isPw ? 'text' : 'password';
  $('toggleNewsKey').textContent = isPw ? 'ocultar' : 'ver';
});

$('btnSaveSettings').addEventListener('click', () => {
  const cfg = {
    apiKey: apiKeyEl.value.trim(),
    model: modelEl.value,
    thinkingLevel: thinkingLevelEl.value || DEFAULT_CONFIG.thinkingLevel,
    useSearch: useSearchEl.checked,
    worldNewsKey: worldNewsKeyEl.value.trim(),
    useNews: useNewsEl.checked,
    newsCount: parseInt(newsCountEl.value, 10) || DEFAULT_CONFIG.newsCount,
    newsLang: newsLangEl.value || ''
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
