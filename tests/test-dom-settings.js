'use strict';
/* Prueba DOM headless: sección de configuración de World News API en el modal. */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('no-sandbox');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 920, height: 1040, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 1500));

  const r = await win.webContents.executeJavaScript(`(() => {
    document.getElementById('worldNewsKey').value = 'clave-de-ejemplo';
    document.getElementById('settingsModal').classList.add('open');
    const s = document.querySelector('.settings-section');
    return {
      hasSection: !!s,
      title: s ? s.querySelector('.settings-section-title').textContent.trim() : '',
      hasKey: !!document.getElementById('worldNewsKey'),
      hasUseNews: !!document.getElementById('useNews'),
      hasCount: !!document.getElementById('newsCount'),
      hasLang: !!document.getElementById('newsLang'),
      countValue: document.getElementById('newsCount').value,
      useNewsChecked: document.getElementById('useNews').checked
    };
  })()`);
  console.log('RESULT ' + JSON.stringify(r));

  try { win.webContents.invalidate(); } catch (e) {}
  await new Promise((r) => setTimeout(r, 900));
  const shot = await win.webContents.capturePage();
  fs.mkdirSync(path.join(__dirname,'..','screenshots'),{recursive:true}); fs.writeFileSync(path.join(__dirname,'..','screenshots','ui-settings-news.png'), shot.toPNG());
  console.log('SCREENSHOT_SAVED');
  app.quit();
});
