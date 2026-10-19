'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('no-sandbox');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1180, height: 940, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 1500));

  const info = await win.webContents.executeJavaScript(`(() => {
    const out = {};

    // --- 1. parseMetaBlock / stripMeta ---
    currentMarkdown = '# Informe de prueba\\n\\nContenido del informe...\\n\\n' +
      '\`\`\`geointel-meta\\n{"ubicacion":{"nombre":"Gaza, Franja de Gaza","lat":31.5017,"lng":34.4668},"puntos":[{"nombre":"Tel Aviv","lat":32.0853,"lng":34.7818},{"nombre":"Rafah","lat":31.2968,"lng":34.2465}]}\\n\`\`\`';
    stripMeta();
    out.metaParsed = !!currentMeta;
    out.metaName = currentMeta && currentMeta.ubicacion && currentMeta.ubicacion.nombre;
    out.metaPoints = currentMeta && currentMeta.puntos ? currentMeta.puntos.length : 0;
    out.metaStripped = currentMarkdown.indexOf('geointel-meta') === -1;

    // --- 2. grounding + ubicación + fotos falsas ---
    currentGrounding = {
      sources: [
        { uri: 'https://www.reuters.com/world/gaza', title: 'reuters.com' },
        { uri: 'https://apnews.com/article/gaza', title: 'apnews.com' }
      ],
      queries: ['conflicto Gaza octubre 2026', 'últimas noticias Franja de Gaza'],
      urls: [{ key: 'k', url: 'https://www.aljazeera.com/news/gaza', status: 'URL_RETRIEVAL_STATUS_SUCCESS' }],
      searchWidget: null
    };
    currentLocation = { name: 'Gaza, Franja de Gaza', lat: 31.5017, lng: 34.4668,
      points: [{ nombre: 'Tel Aviv', lat: 32.0853, lng: 34.7818 }, { nombre: 'Rafah', lat: 31.2968, lng: 34.2465 }] };

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240">' +
      '<rect width="400" height="240" fill="#12203a"/>' +
      '<text x="200" y="125" fill="#e8b923" font-size="22" font-family="sans-serif" text-anchor="middle">Foto de ejemplo</text></svg>';
    const dataUrl = 'data:image/svg+xml;base64,' + btoa(svg);
    currentImages = [
      { page: 'https://www.reuters.com/world/gaza', image: dataUrl, title: 'reuters.com' },
      { page: 'https://apnews.com/article/gaza', image: dataUrl, title: 'apnews.com' },
      { page: 'https://www.aljazeera.com/news/gaza', image: dataUrl, title: 'aljazeera.com' }
    ];

    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('report').innerHTML = renderMarkdown(currentMarkdown);
    renderReportExtras();

    // --- 3. comprobaciones DOM ---
    out.extrasVisible = document.getElementById('reportExtras').style.display !== 'none';
    out.hasMap = !!document.getElementById('geoMap');
    out.mapInitialized = !!mapInstance;
    out.hasLeaflet = !!(window.L && window.L.map);
    out.photoCount = document.querySelectorAll('.rx-photo').length;
    out.refCount = document.querySelectorAll('.rx-refs li').length;
    out.queryCount = document.querySelectorAll('.rx-query').length;
    out.titleCount = document.querySelectorAll('.rx-title').length;
    out.osmLink = !!document.querySelector('.rx-osm-link');

    // --- 4. buildFullMarkdown ---
    const full = buildFullMarkdown();
    out.fullHasLocation = full.indexOf('Ubicación geográfica') !== -1;
    out.fullHasSources = full.indexOf('Fuentes y referencias') !== -1;
    out.fullHasPhotos = full.indexOf('Fotografías de las fuentes') !== -1;

    return out;
  })()`);
  console.log('DOM_INFO:' + JSON.stringify(info));

  
  await new Promise((r) => setTimeout(r, 2500)); // dar tiempo a los tiles
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.join(__dirname,'..','screenshots'),{recursive:true}); fs.writeFileSync(path.join(__dirname,'..','screenshots','ui-extras.png'), img.toPNG());
  console.log('SCREENSHOT_SAVED');

  app.quit();
});
