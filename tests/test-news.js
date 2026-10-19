'use strict';
/* Prueba del handler IPC news:search (World News API) + utilidades de noticias. */

const Module = require('module');
const path = require('path');
const origLoad = Module._load;

const handlers = {};
const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
const app = {
  getPath: () => '/tmp/geointel-test',
  whenReady: () => ({ then: () => {} }),
  on: () => {}
};
function BrowserWindow() {
  return { loadFile() {}, webContents: { setWindowOpenHandler() {}, on() {} }, on() {} };
}
BrowserWindow.getAllWindows = () => [];

Module._load = function (request) {
  if (request === 'electron') return { app, BrowserWindow, ipcMain, shell: { openExternal() {} } };
  return origLoad.apply(this, arguments);
};

const FAKE_NEWS = {
  offset: 0, number: 3, available: 143,
  news: [
    { id: 1, title: 'Taiw\u00e1n repeli\u00f3 16 embarcaciones chinas', text: 'guerra h\u00edbrida estrecho', summary: 'China estrecho de Taiw\u00e1n', url: 'https://reuters.com/a', image: 'https://img.example.com/a.jpg', video: '', publish_date: '2026-10-19 16:31:38', authors: ['Ana'], category: 'politics', language: 'es', source_country: 'es', sentiment: -0.4 },
    { id: 2, title: 'Sin URL v\u00e1lida', text: '', summary: '', url: '', image: '', publish_date: '2026-10-19 10:00:00', authors: [], category: '', language: 'es', source_country: 'es', sentiment: 0.1 },
    { id: 3, title: 'Baloncesto en Taiw\u00e1n', text: 'liga de baloncesto', summary: 'deporte', url: 'https://espn.com/b', image: '', video: '', publish_date: '2026-10-19 19:00:00', authors: [], category: 'sports', language: 'es', source_country: 'us', sentiment: null }
  ]
};

let lastUrl = '', lastHeaders = {};
global.fetch = async (url, opts) => {
  lastUrl = String(url); lastHeaders = (opts && opts.headers) || {};
  if (/api\.worldnewsapi\.com/.test(url)) {
    if (lastHeaders['x-api-key'] === 'BAD') {
      return { ok: false, status: 401, headers: { get: () => 'application/json' }, text: async () => 'unauthorized', json: async () => ({}) };
    }
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => FAKE_NEWS, text: async () => '' };
  }
  return { ok: false, status: 404, headers: { get: () => null }, text: async () => 'nope', json: async () => ({}) };
};

require(path.join(__dirname, '..', 'main.js'));
const GeoNews = require(path.join(__dirname, '..', 'renderer', 'news-util.js'));

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name); }
}

(async () => {
  console.log('== news-util ==');
  check('buildQuery extrae keywords del tema',
    GeoNews.buildQuery('Tensi\u00f3n en el Estrecho de Taiw\u00e1n entre China, Taiw\u00e1n y Estados Unidos') === 'estrecho taiwan china');
  check('buildQuery descarta gen\u00e9ricos', GeoNews.buildQuery('Guerra en Ucrania') === 'guerra ucrania');
  check('normalizeItem descarta art\u00edculos sin URL', GeoNews.normalizeItem({ title: 'x' }) === null);
  const n0 = GeoNews.normalizeItem(FAKE_NEWS.news[0]);
  check('normalizeItem mapea campos', n0.publishDate === '2026-10-19 16:31:38' && n0.sourceCountry === 'es' && n0.sentiment === -0.4 && n0.image === 'https://img.example.com/a.jpg');
  const ranked = GeoNews.rank([n0, GeoNews.normalizeItem(FAKE_NEWS.news[2])], GeoNews.keywords('Tensi\u00f3n en el Estrecho de Taiw\u00e1n'), 5);
  check('rank prioriza la noticia relevante', ranked.length >= 1 && /embarcaciones/.test(ranked[0].title));
  check('sentimentLabel clasifica', GeoNews.sentimentLabel(-0.5).cls === 'neg' && GeoNews.sentimentLabel(0).cls === 'neu' && GeoNews.sentimentLabel(0.6).cls === 'pos');

  console.log('== news:search ==');
  check('handler existe', typeof handlers['news:search'] === 'function');
  const r = await handlers['news:search'](null, { apiKey: 'K', query: 'estrecho taiwan china', number: 40 });
  check('ok=true', r.ok === true);
  check('available propagado', r.available === 143);
  check('descarta art\u00edculo sin URL', r.news.length === 2);
  check('usa cabecera x-api-key', lastHeaders['x-api-key'] === 'K');
  check('ordena por publish-time DESC', /sort=publish-time/.test(lastUrl) && /sort-direction=DESC/.test(lastUrl));
  check('incluye text= con la consulta', /text=estrecho\+taiwan\+china|text=estrecho%20taiwan%20china/.test(lastUrl));
  check('respeta number', /number=40/.test(lastUrl));

  const noKey = await handlers['news:search'](null, { query: 'x' });
  check('sin API key -> ok=false', noKey.ok === false && /API key/.test(noKey.error));

  const bad = await handlers['news:search'](null, { apiKey: 'BAD', query: 'x' });
  check('401 -> ok=false con pista de clave', bad.ok === false && /no v\u00e1lida/.test(bad.error));

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
