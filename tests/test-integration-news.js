'use strict';
/* Prueba de integración: app real (main.js) + puente preload + World News API en vivo. */
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('no-sandbox');
require('../main.js'); // registra los handlers IPC y crea la ventana

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 60 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0];
    if (!win) await new Promise((r) => setTimeout(r, 100));
  }
  if (!win) { console.log('RESULT {"error":"no_window"}'); app.quit(); return; }
  await new Promise((r) => setTimeout(r, 3000));

  try {
    const r = await win.webContents.executeJavaScript(`(async () => {
      const res = await window.geointel.searchNews({
        apiKey: '${process.env.WORLD_NEWS_API_KEY || ''}',
        query: 'estrecho taiwan china',
        number: 20
      });
      const n = (res.news || [])[0] || {};
      return {
        ok: res.ok,
        available: res.available,
        count: (res.news || []).length,
        firstTitle: n.title || null,
        firstHasImage: !!n.image,
        firstHasDate: !!n.publishDate,
        firstSentiment: n.sentiment
      };
    })()`);
    console.log('RESULT ' + JSON.stringify(r));
  } catch (e) {
    console.log('RESULT {"error":' + JSON.stringify(e.message) + '}');
  }
  app.quit();
});
