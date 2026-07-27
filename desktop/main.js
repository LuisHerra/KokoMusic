const { app, BrowserWindow, globalShortcut, Tray, Menu, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow = null;
let backendProcess = null;

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function checkUrl(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(res.statusCode < 400 || res.statusCode === 404);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureBackendRunning() {
  const isBackendUp = await checkUrl('http://localhost:3001/api/health');
  if (!isBackendUp) {
    console.log('[Desktop] Starting background Node.js backend server...');
    const rootDir = path.join(__dirname, '..');
    
    // Spawn tsx / ts-node-dev backend process automatically
    backendProcess = spawn('npx', ['--prefix', 'backend', 'ts-node-dev', '--respawn', '--transpile-only', 'src/app.ts'], {
      cwd: rootDir,
      shell: true,
      stdio: 'ignore'
    });

    // Wait up to 5 seconds for backend server startup
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 250));
      const ok = await checkUrl('http://localhost:3001/api/health');
      if (ok) break;
    }
  }
}

async function createWindow() {
  await ensureBackendRunning();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'KokoMusic Desktop',
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false, // ZERO throttling when minimized/gaming
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Check if frontend Vite dev server is running on 5173, otherwise fallback to local backend static server
  const isDevViteUp = await checkUrl('http://localhost:5173');
  const targetUrl = isDevViteUp ? 'http://localhost:5173' : 'http://localhost:3001/kokoMusic/';

  console.log(`[Desktop] Loading KokoMusic URL: ${targetUrl}`);
  mainWindow.loadURL(targetUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Register Global Media Keys & Global Voice Shortcut (Alt+V) for gaming
  try {
    globalShortcut.register('MediaPlayPause', () => {
      mainWindow?.webContents.send('media-key', 'play-pause');
    });
    globalShortcut.register('MediaNextTrack', () => {
      mainWindow?.webContents.send('media-key', 'next-track');
    });
    globalShortcut.register('MediaPreviousTrack', () => {
      mainWindow?.webContents.send('media-key', 'prev-track');
    });

    // Global Voice Control Shortcut (Alt+V)
    globalShortcut.register('Alt+V', () => {
      mainWindow?.webContents.send('media-key', 'toggle-voice');
    });
  } catch (err) {
    console.error('[Desktop] Error registering global media/voice shortcuts:', err);
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (backendProcess) {
    try { backendProcess.kill(); } catch {}
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
