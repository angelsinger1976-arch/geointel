'use strict';
/* Prueba DOM headless: sección de noticias (World News API) en el informe. */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('no-sandbox');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1180, height: 1000, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 1500));

  const result = await win.webContents.executeJavaScript(`(() => {
    const img = 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#0e1728"/><text x="200" y="128" fill="#e8b923" font-size="24" text-anchor="middle" font-family="sans-serif">GEOINTEL</text></svg>');
    currentNews = [
      { id: 1, title: 'Taiw\\u00e1n repeli\\u00f3 16 embarcaciones chinas en un d\\u00eda', summary: 'La isla denunci\\u00f3 una operaci\\u00f3n de guerra h\\u00edbrida de Beijing en el estrecho.', url: 'https://reuters.com/world/taiwan-1', image: img, publishDate: '2026-10-19 16:31:38', sourceCountry: 'es', sentiment: -0.42, category: 'politics', language: 'es', authors: ['X'] },
      { id: 2, title: 'Ocho pa\\u00edses elevan la presi\\u00f3n sobre China ante una ofensiva contra Taiw\\u00e1n', summary: 'Los aliados coordinan su postura en el Indo-Pac\\u00edfico.', url: 'https://apnews.com/taiwan-2', image: '', publishDate: '2026-10-06 20:20:35', sourceCountry: 'us', sentiment: 0.05, category: 'politics', language: 'es', authors: [] },
      { id: 3, title: 'Alemania eval\\u00faa el impacto de un posible bloqueo de China contra Taiw\\u00e1n', summary: 'Informe del gobierno alem\\u00e1n sobre cadenas de suministro.', url: 'https://dw.com/taiwan-3', image: img, publishDate: '2026-10-06 22:02:33', sourceCountry: 'de', sentiment: -0.1, category: 'politics', language: 'es', authors: [] }
    ];
    currentNewsQuery = 'estrecho taiwan china';
    currentLocation = { name: 'Estrecho de Taiw\\u00e1n', lat: 24.5, lng: 120.5, points: [] };
    currentGrounding = { sources: [{ uri: 'https://reuters.com/world/taiwan-1', title: 'reuters.com' }], queries: ['estrecho de Taiw\\u00e1n'], urls: [], searchWidget: null };
    document.getElementById('emptyState').style.display = 'none';
    renderReportExtras();

    const sec = document.querySelector('.rx-news-sec');
    const cards = document.querySelectorAll('.rx-news-card');
    const md = buildFullMarkdown();

    // Caso 2: solo noticias (sin mapa ni fuentes) -> la sección debe seguir visible.
    currentLocation = null; currentGrounding = { sources: [], queries: [], urls: [], searchWidget: null }; currentImages = [];
    renderReportExtras();
    const secOnlyNews = !!document.querySelector('.rx-news-sec');

    return {
      hasSection: !!sec,
      cardCount: cards.length,
      sentCount: document.querySelectorAll('.rx-sent').length,
      imgCount: document.querySelectorAll('.rx-news-thumb img').length,
      title: sec ? sec.querySelector('.rx-title').textContent.trim() : '',
      sub: sec ? sec.querySelector('.rx-sub').textContent.trim() : '',
      firstTitle: cards[0] ? cards[0].querySelector('.rx-news-title a').textContent : '',
      firstHref: cards[0] ? cards[0].querySelector('.rx-news-title a').getAttribute('href') : '',
      hasNewsInMarkdown: /Noticias recientes \\(World News API\\)/.test(md),
      secOnlyNews: secOnlyNews
    };
  })()`);

  console.log('RESULT ' + JSON.stringify(result));

  // Re-render con mapa+fuentes para la captura
  const hidden = await win.webContents.executeJavaScript(`(() => {
    currentLocation = { name: 'Estrecho de Taiw\\u00e1n', lat: 24.5, lng: 120.5, points: [] };
    currentGrounding = { sources: [{ uri: 'https://reuters.com/world/taiwan-1', title: 'reuters.com' }], queries: ['estrecho de Taiw\\u00e1n'], urls: [], searchWidget: null };
    renderReportExtras();
    const st = document.createElement('style');
    st.textContent = '.topbar,.query-panel,.output-toolbar,#report,#sourcesPanel,.rx-map-sec,.rx-photos-sec,.rx-sources-sec{display:none !important}';
    document.head.appendChild(st);
    return {
      topbar: getComputedStyle(document.querySelector('.topbar')).display,
      news: getComputedStyle(document.querySelector('.rx-news-sec')).display
    };
  })()`);
  console.log('HIDDEN ' + JSON.stringify(hidden));
  try { win.webContents.invalidate(); } catch (e) {}
  await new Promise((r) => setTimeout(r, 1200));
  const shot = await win.webContents.capturePage();
  fs.mkdirSync(path.join(__dirname,'..','screenshots'),{recursive:true}); fs.writeFileSync(path.join(__dirname,'..','screenshots','ui-news.png'), shot.toPNG());
  console.log('SCREENSHOT_SAVED');
  app.quit();
});
