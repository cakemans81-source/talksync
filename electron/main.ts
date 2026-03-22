// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app, BrowserWindow, ipcMain, desktopCapturer, shell, protocol, net } = require('electron') as typeof import('electron');
import path from 'path';
import { pathToFileURL } from 'url';
import { execFile } from 'child_process';
import fs from 'fs';

const PROTOCOL = 'talksync';

// app:// 커스텀 프로토콜 — file:// 대신 사용하여 서브 페이지에서도 에셋 경로가 항상 out/ 루트 기준으로 해석됨
// (app.whenReady() 호출 전에 등록해야 함)
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true } },
]);
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

  // 마이크 / 음성인식 / 오디오 출력 장치 선택 권한 자동 허용
  // speaker-selection: AudioContext.setSinkId / HTMLAudioElement.setSinkId 가 VB-Cable 등
  //   특정 출력 장치로 라우팅할 때 필요 (Electron 권한명 — audiooutput 아님)
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['microphone', 'media', 'audioCapture', 'speechRecognition', 'speaker-selection'];
    callback(allowed.includes(permission));
  });
  mainWindow.webContents.session.setPermissionCheckHandler((_wc, permission) => {
    const allowed = ['microphone', 'media', 'audioCapture', 'speechRecognition', 'speaker-selection'];
    return allowed.includes(permission);
  });

  // Electron 20+: 미디어 장치(마이크, 카메라, 스피커) 선택 권한을 묻지 않고 항상 허용
  // setSinkId로 VB-Cable 등 특정 출력 장치로 오디오를 라우팅하려면 이 핸들러가 반드시 필요
  mainWindow.webContents.session.setDevicePermissionHandler((_details) => {
    return true; // 모든 미디어 장치 권한 무조건 허용
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
    mainWindow.loadURL('app://localhost/studio/index.html');
  }
}

app.whenReady().then(() => {
  // app:// 요청을 out/ 폴더의 정적 파일로 라우팅
  const outDir = path.join(__dirname, '../out');
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const filePath = path.join(outDir, pathname);
    return net.fetch(pathToFileURL(filePath).toString());
  });

  createWindow();

  // ── Edge TTS WebSocket 403 수정 ───────────────────────────────
  // app:// 프로토콜의 Origin 헤더("app://localhost")를 Microsoft 서버가 거부함
  // Chrome Extension Origin으로 교체하여 정상 연결 허용
  const { session } = require('electron') as typeof import('electron');
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['wss://speech.platform.bing.com/*'] },
    (details: { requestHeaders: Record<string, string> }, callback: (r: { requestHeaders: Record<string, string> }) => void) => {
      details.requestHeaders['Origin'] = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
      callback({ requestHeaders: details.requestHeaders });
    }
  );
});

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
