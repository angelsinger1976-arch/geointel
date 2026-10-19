'use strict';
/* Prueba de los handlers IPC de main.js (geo:geocode y media:images) */
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

function mkRes(o) {
  o = o || {};
  return {
    ok: o.ok !== false,
    status: o.status || 200,
    headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? (o.ct || 'text/html') : null) },
    text: async () => o.body || '',
    json: async () => o.json,
    arrayBuffer: async () => o.buf
  };
}

global.fetch = async (url) => {
  if (/nominatim/.test(url)) {
    return mkRes({ ct: 'application/json', json: [{ lat: '31.5017', lon: '34.4668', display_name: 'Gaza, Franja de Gaza, Palestina' }] });
  }
  if (/reuters\.com/.test(url)) {
    return mkRes({ body: '<html><head><meta property="og:image" content="https://img.example.com/a.jpg"></head></html>' });
  }
  if (/img\.example\.com/.test(url)) {
    return mkRes({ ct: 'image/jpeg', buf: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4]) });
  }
  return mkRes({ ok: false, status: 404, body: 'nope' });
};

require(path.join(__dirname, '..', 'main.js'));

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name); }
}

(async () => {
  console.log('== geo:geocode ==');
  const geo = await handlers['geo:geocode'](null, { query: 'Gaza' });
  check('handler existe', typeof handlers['geo:geocode'] === 'function');
  check('ok=true', geo.ok === true);
  check('lat correcta', Math.abs(geo.lat - 31.5017) < 1e-6);
  check('lng correcta', Math.abs(geo.lng - 34.4668) < 1e-6);
  check('name presente', /Gaza/.test(geo.name || ''));
  const geoEmpty = await handlers['geo:geocode'](null, { query: '' });
  check('consulta vacía -> ok=false', geoEmpty.ok === false);

  console.log('== media:images ==');
  check('handler existe', typeof handlers['media:images'] === 'function');
  const imgs = await handlers['media:images'](null, { urls: ['https://www.reuters.com/world/x'] });
  check('ok=true', imgs.ok === true);
  check('1 imagen extraída', imgs.images.length === 1);
  check('es data URL jpeg', /^data:image\/jpeg;base64,/.test(imgs.images[0].image || ''));
  check('title = dominio', imgs.images[0].title === 'reuters.com');
  check('page = url fuente', imgs.images[0].page === 'https://www.reuters.com/world/x');

  const imgs2 = await handlers['media:images'](null, { urls: ['not-a-url', 'ftp://x'] });
  check('urls inválidas -> 0 imágenes', imgs2.images.length === 0);

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
