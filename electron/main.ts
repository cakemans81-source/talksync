// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app, BrowserWindow, ipcMain, desktopCapturer, shell } = require('electron') as typeof import('electron');
import path from 'path';
import { execFile } from 'child_process';
import fs from 'fs';

const PROTOCOL = 'talksync';
const isDev = !app.isPackaged;

// ── 단일 인스턴스 강제 ────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// ── 딥링크 프로토콜 등록 (OAuth 콜백용) ─────────────────────────
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

type BrowserWindowType = InstanceType<typeof BrowserWindow>;
let mainWindow: BrowserWindowType | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#fafafa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // 마이크 / 음성인식 권한 자동 허용 (Web Speech API용)
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['microphone', 'media', 'audioCapture', 'speechRecognition'];
    callback(allowed.includes(permission));
  });
  mainWindow.webContents.session.setPermissionCheckHandler((_wc, permission) => {
    const allowed = ['microphone', 'media', 'audioCapture', 'speechRecognition'];
    return allowed.includes(permission);
  });

  // Electron 27+: getUserMedia({ chromeMediaSource:'desktop' }) 허용
  mainWindow.webContents.session.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' });
    }).catch(() => callback({}));
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../out/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── desktopCapturer: 시스템 오디오 소스 ID 반환 ──────────────────
// 렌더러에서 getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop', ... } } })
// 형태로 시스템 오디오를 바로 캡처할 수 있도록 sourceId를 전달
ipcMain.handle('get-system-audio-source-id', async (): Promise<string | null> => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  return sources[0]?.id ?? null;
});

// ── 외부 브라우저 열기 (Google OAuth 팝업) ───────────────────────
ipcMain.on('open-external', (_event, url: string) => {
  shell.openExternal(url);
});

// ── OAuth 딥링크 처리: Windows / Linux (second-instance) ─────────
app.on('second-instance', (_event, argv) => {
  const deepLink = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
  if (deepLink && mainWindow) {
    mainWindow.webContents.send('oauth-callback', deepLink);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ── OAuth 딥링크 처리: macOS (open-url) ──────────────────────────
app.on('open-url', (event, url) => {
  event.preventDefault();
  mainWindow?.webContents.send('oauth-callback', url);
});

// ── Windows SAPI TTS: 텍스트 → WAV 버퍼 ─────────────────────────
// Web Speech Synthesis는 AudioContext로 캡처 불가 → 메인 프로세스에서 직접 생성
ipcMain.handle('synthesize-tts', async (_event, text: string, langCode: string): Promise<Buffer | null> => {
  const tmpDir = app.getPath('temp');
  const txtPath = path.join(tmpDir, `tts_in_${Date.now()}.txt`);
  const wavPath = path.join(tmpDir, `tts_out_${Date.now()}.wav`);
  const lang = langCode.split('-')[0]; // 'ko', 'en', 'ja', ...

  try {
    fs.writeFileSync(txtPath, text, 'utf8');

    const script = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      `foreach ($v in $s.GetInstalledVoices()) { if ($v.VoiceInfo.Culture.Name.StartsWith('${lang}')) { $s.SelectVoice($v.VoiceInfo.Name); break } }`,
      `$s.SetOutputToWaveFile('${wavPath.replace(/\\/g, '\\\\')}')`,
      `$s.Speak([System.IO.File]::ReadAllText('${txtPath.replace(/\\/g, '\\\\')}', [System.Text.Encoding]::UTF8))`,
      '$s.Dispose()',
    ].join('; ');

    await new Promise<void>((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 15000 },
        (err) => { if (err) reject(err); else resolve(); });
    });

    const buf = fs.readFileSync(wavPath);
    return buf;
  } catch (e) {
    console.error('[TTS synthesize]', e);
    return null;
  } finally {
    try { fs.unlinkSync(txtPath); } catch { /* ignore */ }
    try { fs.unlinkSync(wavPath); } catch { /* ignore */ }
  }
});
