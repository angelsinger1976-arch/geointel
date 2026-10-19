'use strict';

/* ============================================================
   GEOINTEL — Utilidades de noticias (World News API)
   Funciones puras compartidas por el proceso principal (Node) y
   el renderer (navegador). Se cargan con `require` en Node y como
   `window.GeoNews` en la interfaz.
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeoNews = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null), function () {

  /* Palabras vacías (es/en/pt/fr) que no aportan a la búsqueda. */
  const STOP = new Set([
    // español
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'en', 'y', 'o', 'u',
    'a', 'al', 'con', 'por', 'para', 'sin', 'sobre', 'entre', 'hacia', 'desde', 'hasta',
    'que', 'como', 'su', 'sus', 'se', 'lo', 'le', 'les', 'es', 'son', 'fue', 'ser', 'esta',
    'estan', 'este', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'muy', 'mas', 'menos',
    // inglés
    'the', 'of', 'and', 'to', 'in', 'on', 'for', 'with', 'without', 'over', 'under',
    'between', 'from', 'into', 'about', 'that', 'this', 'these', 'those', 'is', 'are',
    'was', 'were', 'be', 'been', 'an', 'as', 'at', 'by', 'it', 'its', 'or', 'not',
    // portugués / francés
    'um', 'uma', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'e', 'ou', 'com', 'seu',
    'sua', 'le', 'les', 'des', 'du', 'une', 'et', 'dans', 'sur', 'pour', 'avec', 'sans',
    'qui', 'son', 'sa', 'ses', 'au', 'aux', 'aux', 'des', 'une'
  ]);

  /* Términos demasiado genéricos: no discriminan y, al ser la búsqueda de la
     API de tipo AND, reducirían en exceso los resultados. Se descartan si
     queda algún término más específico. */
  const GENERIC = new Set([
    'tension', 'tensiones', 'crisis', 'conflicto', 'conflictos', 'situacion',
    'actual', 'actualidad', 'analisis', 'internacional', 'mundial', 'mundo',
    'region', 'regional', 'pais', 'paises', 'nuevo', 'nueva', 'ultimo', 'ultima',
    'gran', 'grandes', 'tema', 'caso', 'estado', 'estados', 'unidos', 'naciones',
    'union', 'republica', 'gobierno', 'presidente', 'ministro'
  ]);

  /* Normaliza texto: minúsculas, sin acentos, sin signos, espacios simples. */
  function norm(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Extrae las palabras significativas de un tema (sin palabras vacías). */
  function keywords(topic) {
    const toks = norm(topic).split(' ').filter(Boolean);
    const out = [];
    for (const t of toks) {
      if (t.length < 3) continue;
      if (STOP.has(t)) continue;
      if (!out.includes(t)) out.push(t);
    }
    return out;
  }

  /* Construye la consulta `text` para la World News API a partir del tema.
     Descarta términos genéricos y limita a 4 palabras clave (la búsqueda de la
     API es de tipo AND: menos términos = más resultados, más precisos). */
  function buildQuery(topic) {
    const all = keywords(topic);
    let kws = all.filter((k) => !GENERIC.has(k));
    if (!kws.length) kws = all;                     // si todo era genérico, se usa tal cual
    if (!kws.length) return norm(topic).slice(0, 120);
    return kws.slice(0, 4).join(' ').slice(0, 200);
  }

  /* Marca temporal (ms) de una fecha de la API ("YYYY-MM-DD HH:MM:SS", UTC). */
  function ts(dateStr) {
    const s = String(dateStr || '').trim();
    if (!s) return 0;
    let t = Date.parse(s.replace(' ', 'T') + (/(Z|[+-]\d\d:?\d\d)$/.test(s) ? '' : 'Z'));
    if (!isFinite(t)) t = Date.parse(s);
    return isFinite(t) ? t : 0;
  }

  /* Convierte un artículo de la API al formato interno de GEOINTEL. */
  function normalizeItem(n) {
    if (!n || typeof n !== 'object') return null;
    const url = String(n.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return null;
    return {
      id: n.id || url,
      title: String(n.title || '').trim(),
      text: String(n.text || ''),
      summary: String(n.summary || '').trim(),
      url,
      image: /^https?:\/\//i.test(n.image || '') ? String(n.image) : '',
      video: /^https?:\/\//i.test(n.video || '') ? String(n.video) : '',
      publishDate: String(n.publish_date || ''),
      authors: Array.isArray(n.authors) ? n.authors.slice(0, 4).map(String) : [],
      category: String(n.category || ''),
      language: String(n.language || ''),
      sourceCountry: String(n.source_country || ''),
      sentiment: (typeof n.sentiment === 'number' && isFinite(n.sentiment)) ? n.sentiment : null
    };
  }

  /* Puntúa y ordena los artículos por relevancia respecto a las palabras clave.
     Prioriza coincidencias en el título (3), resumen (2) y cuerpo (1); a igual
     puntuación, los más recientes primero. Descarta los que no coinciden. */
  function rank(items, kws, limit) {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    const keys = (kws || []).map((k) => norm(k)).filter(Boolean);

    const scored = list.map((it) => {
      const title = norm(it.title);
      const summary = norm(it.summary);
      const body = norm(String(it.text || '').slice(0, 4000));
      let score = 0;
      for (const k of keys) {
        if (title.includes(k)) score += 3;
        else if (summary.includes(k)) score += 2;
        else if (body.includes(k)) score += 1;
      }
      return { it, score };
    });

    scored.sort((a, b) => (b.score - a.score) || (ts(b.it.publishDate) - ts(a.it.publishDate)));

    const filtered = keys.length ? scored.filter((s) => s.score > 0) : scored;
    const use = filtered.length ? filtered : scored;
    return use.slice(0, limit || use.length).map((s) => s.it);
  }

  /* Etiqueta legible del sentimiento (-1..1). */
  function sentimentLabel(s) {
    if (typeof s !== 'number' || !isFinite(s)) return null;
    if (s <= -0.35) return { label: 'negativo', cls: 'neg' };
    if (s >= 0.35) return { label: 'positivo', cls: 'pos' };
    return { label: 'neutro', cls: 'neu' };
  }

  return { norm, keywords, buildQuery, ts, normalizeItem, rank, sentimentLabel };
});
