// JW Dash desktop: runs the full app locally (own database, works offline) and syncs with the JW Dash server.
const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('node:path');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

if (!app.requestSingleInstanceLock()) app.quit();

const PREFERRED_PORT = 51707; // fixed so sign-in and view settings persist between launches

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}
async function pickPort() {
  if (await portFree(PREFERRED_PORT)) return PREFERRED_PORT;
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

let win;
// packaged: the server and UI ship as an extra resource; in development they sit next to this file
const base = app.isPackaged ? path.join(process.resourcesPath, 'jwapp') : path.join(__dirname, 'app');

async function boot() {
  const port = await pickPort();
  process.env.JW_NODE = '1';
  process.env.JW_DB = path.join(app.getPath('userData'), 'jw_dash.db');
  process.env.JW_DIST = path.join(base, 'client', 'dist');
  process.env.JW_BIND = '127.0.0.1';
  process.env.PORT = String(port);
  process.removeAllListeners('warning');

  const { ready } = await import(pathToFileURL(path.join(base, 'server', 'src', 'index.js')).href);
  await ready;

  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 360, minHeight: 500,
    title: 'JW Dash', backgroundColor: '#ffffff', autoHideMenuBar: true,
    icon: path.join(base, 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadURL(`http://127.0.0.1:${port}`);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(boot).catch((e) => {
  dialog.showErrorBox('JW Dash could not start', String(e?.stack || e));
  app.quit();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
