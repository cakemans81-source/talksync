// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app, BrowserWindow, ipcMain, desktopCapturer, shell, protocol, net, session } = require('electron') as typeof import('electron');
import path from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs';

const PROTOCOL = 'talksync';

// app:// 커스텀 프로토콜 — file:// 대신 사용하여 서브 페이지에서도 에셋 경로가 항상 out/ 루트 기준으로 해석됨
// (app.whenReady() 호출 전에 등록해야 함)
// corsEnabled: true → Module Worker (ort-wasm-simd-threaded.mjs) 로드 허용
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } },
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
  mainWindow.webContents.session.setDevicePermissionHandler(() => true); // 모든 미디어 장치 권한 무조건 허용

  // Electron 27+: getUserMedia({ chromeMediaSource:'desktop' }) 허용
  mainWindow.webContents.session.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' });
    }).catch(() => callback({}));
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000/studio');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL('app://localhost/studio/index.html');
  }
}

app.whenReady().then(() => {
  // app:// 요청을 out/ 폴더의 정적 파일로 라우팅
  // COOP/COEP 헤더 추가 → crossOriginIsolated = true → SharedArrayBuffer 활성화
  //   SharedArrayBuffer는 onnxruntime-web(threaded WASM)이 필수로 요구
  //   COEP 'credentialless' = require-corp보다 완화 (서드파티 리소스 쿠키 없이 허용)
  const outDir = path.resolve(__dirname, '../out');
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    // 경로 트래버설 방지: 디코딩 후 outDir 내부로 해석되는 경로만 허용
    let filePath: string;
    try {
      filePath = path.resolve(outDir, '.' + decodeURIComponent(pathname));
    } catch {
      return new Response('Not found', { status: 404 });
    }
    if (filePath !== outDir && !filePath.startsWith(outDir + path.sep)) {
      return new Response('Not found', { status: 404 });
    }
    const response = await net.fetch(pathToFileURL(filePath).toString());

    const headers = new Headers(response.headers);
    // Cross-Origin Isolation — SharedArrayBuffer + Module Worker 활성화
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });

  createWindow();

  // ── Edge TTS WebSocket 403 수정 ───────────────────────────────
  // app:// 프로토콜의 Origin 헤더("app://localhost")를 Microsoft 서버가 거부함
  // Chrome Extension Origin으로 교체하여 정상 연결 허용
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
  // 'screen:' prefix를 가진 소스를 우선 선택 (window 소스 제외)
  const screenSource = sources.find((s) => s.id.startsWith('screen:')) ?? sources[0];
  console.log('[main] system audio sources:', sources.map((s) => s.id));
  console.log('[main] selected source:', screenSource?.id);
  return screenSource?.id ?? null;
});

// ── 외부 브라우저 열기 (Google OAuth 팝업) ───────────────────────
// http/https 외 스킴(file:, javascript:, 임의 프로토콜 등)은 무시
ipcMain.on('open-external', (_event, url: string) => {
  try {
    const { protocol: scheme } = new URL(url);
    if (scheme !== 'http:' && scheme !== 'https:') return;
    shell.openExternal(url);
  } catch {
    // 잘못된 URL 무시
  }
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

// ── WAV 파일 저장 IPC ─────────────────────────────────────────────
// 렌더러(wavExporter.ts)에서 ArrayBuffer + 파일명을 전달하면 Downloads/TalkSync/ 에 저장
ipcMain.handle('audio:save-wav', async (_event, buffer: ArrayBuffer, filename: string): Promise<{ ok: boolean; path?: string; reason?: string }> => {
  try {
    const downloadsDir = path.join(app.getPath('downloads'), 'TalkSync');
    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

    // 파일명에서 경로 트래버설 문자 제거 (보안)
    const safeName = path.basename(filename).replace(/[/\\:*?"<>|]/g, '_');
    const filePath  = path.join(downloadsDir, safeName);

    fs.writeFileSync(filePath, Buffer.from(buffer));
    console.log(`[WavExporter] 저장 완료 → ${filePath}`);
    return { ok: true, path: filePath };
  } catch (e) {
    console.error('[audio:save-wav]', e);
    return { ok: false, reason: String(e) };
  }
});
