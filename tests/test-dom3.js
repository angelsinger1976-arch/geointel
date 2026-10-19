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

  await win.webContents.executeJavaScript(`(() => {
    currentGrounding = {
      sources: [
        { uri: 'https://www.reuters.com/world/middle-east/gaza-latest', title: 'reuters.com' },
        { uri: 'https://apnews.com/hub/gaza', title: 'apnews.com' },
        { uri: 'https://www.bbc.com/news/world/middle_east', title: 'bbc.com' }
      ],
      queries: ['conflicto Gaza octubre 2026', 'últimas noticias Franja de Gaza'],
      urls: [{ key: 'k', url: 'https://www.aljazeera.com/news/gaza', status: 'URL_RETRIEVAL_STATUS_SUCCESS' }],
      searchWidget: null
    };
    currentLocation = { name: 'Gaza, Franja de Gaza', lat: 31.5017, lng: 34.4668, points: [] };
    currentImages = [];
    document.getElementById('emptyState').style.display = 'none';
    renderReportExtras();
    document.querySelector('.topbar').style.display = 'none';
    document.querySelector('.query-panel').style.display = 'none';
    document.querySelector('.output-toolbar').style.display = 'none';
    document.getElementById('report').style.display = 'none';
    document.getElementById('sourcesPanel').style.display = 'none';
    document.querySelector('.rx-map-sec').style.display = 'none';
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 700));
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.join(__dirname,'..','screenshots'),{recursive:true}); fs.writeFileSync(path.join(__dirname,'..','screenshots','ui-sources-final.png'), img.toPNG());
  console.log('SCREENSHOT_SAVED');
  app.quit();
});
