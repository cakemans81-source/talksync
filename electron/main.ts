// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app, BrowserWindow, ipcMain, desktopCapturer, shell, protocol, net } = require('electron') as typeof import('electron');
import path from 'path';
import { pathToFileURL } from 'url';
import { execFile, spawnSync } from 'child_process';
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
  // 오디오 라우팅 PowerShell 스크립트 초기화 (임시 디렉토리)
  try { initAudioScripts(app.getPath('temp')); } catch (e) { console.warn('[audio scripts init]', e); }

  // app:// 요청을 out/ 폴더의 정적 파일로 라우팅
  // COOP/COEP 헤더 추가 → crossOriginIsolated = true → SharedArrayBuffer 활성화
  //   SharedArrayBuffer는 onnxruntime-web(threaded WASM)이 필수로 요구
  //   COEP 'credentialless' = require-corp보다 완화 (서드파티 리소스 쿠키 없이 허용)
  const outDir = path.join(__dirname, '../out');
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const filePath = path.join(outDir, pathname);
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
  const { session } = require('electron') as typeof import('electron');
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['wss://speech.platform.bing.com/*'] },
    (details: { requestHeaders: Record<string, string> }, callback: (r: { requestHeaders: Record<string, string> }) => void) => {
      details.requestHeaders['Origin'] = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
      callback({ requestHeaders: details.requestHeaders });
    }
  );
});

// ── Windows 오디오 기본 출력 장치 복원 ────────────────────────────
// CABLE-B 라우팅 활성화 시 기존 장치를 저장, 앱 종료 시 자동 복원
let savedOutputDeviceId: string | null = null;
let audioRestoringFlag = false;

// 임시 .ps1 파일 경로 (app.whenReady 이후 초기화)
let ps1GetDefault = '';
let ps1FindCableB = '';
let ps1SetDefault = '';

function initAudioScripts(tmpDir: string) {
  ps1GetDefault = path.join(tmpDir, 'ts_audio_get.ps1');
  ps1FindCableB = path.join(tmpDir, 'ts_audio_find_cb.ps1');
  ps1SetDefault = path.join(tmpDir, 'ts_audio_set.ps1');

  // 현재 기본 출력 장치 ID 취득 — WinRT로 얻은 전체 ID에서 PolicyConfig 호환 형식 추출
  // WinRT 반환: \\?\SWD#MMDEVAPI#{0.0.0.00000000}.{GUID}#{interface-guid}
  // PolicyConfig 필요: {0.0.0.00000000}.{GUID}
  fs.writeFileSync(ps1GetDefault, [
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    '[void][Windows.Media.Devices.MediaDevice,Windows.Media,ContentType=WindowsRuntime]',
    '$id=[Windows.Media.Devices.MediaDevice]::GetDefaultAudioRenderId([Windows.Media.Devices.AudioDeviceRole]::Default)',
    'if($id -match "#(\\{[0-9\\.]+\\}\\.\\{[0-9a-fA-F\\-]+\\})#"){Write-Output $matches[1]}else{Write-Output $id}',
  ].join('\r\n'), 'utf8');

  // Get-PnpDevice 기반 TalkSync Virtual Audio Cable 탐색 — 레지스트리 FriendlyName이 "스피커"만 저장되어 있어 Get-PnpDevice로 전체 이름 검색
  fs.writeFileSync(ps1FindCableB, [
    '$dev=Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object{$_.FriendlyName -imatch "talksync virtual audio cable" -and $_.InstanceId -match "^SWD\\\\MMDEVAPI\\\\\\{0\\.0\\.0\\."}|Select-Object -First 1',
    'if($dev -and $dev.InstanceId -match "\\{([0-9a-fA-F\\-]+)\\}$"){Write-Output $matches[1]}',
  ].join('\r\n'), 'utf8');

  // PolicyConfig COM 인터페이스로 Windows 기본 출력 장치 변경 (Vista ~ Win11 지원)
  fs.writeFileSync(ps1SetDefault, [
    'param([string]$DeviceId)',
    'Add-Type -Language CSharp -TypeDefinition @\'',
    'using System.Runtime.InteropServices;',
    '[ComImport,Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]class CPolicyConfigClient{}',
    '[Guid("f8679f50-850a-41cf-9c72-430f290290c8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
    'interface IPolicyConfig{',
    '  void n0();void n1();void n2();void n3();void n4();',
    '  void n5();void n6();void n7();void n8();void n9();',
    '  [PreserveSig]int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)]string id,int role);}',
    'public class AD{public static void Set(string id){',
    '  var p=(IPolicyConfig)new CPolicyConfigClient();',
    '  p.SetDefaultEndpoint(id,0);p.SetDefaultEndpoint(id,1);p.SetDefaultEndpoint(id,2);}}',
    '\'@',
    '[AD]::Set($DeviceId)',
  ].join('\r\n'), 'utf8');
}

function psAsync(file: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args],
      { timeout: 12000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`${err.message}\n${stderr}`));
        else resolve(stdout.trim());
      });
  });
}

function psSync(file: string, args: string[] = []): string {
  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args],
    { timeout: 12000 });
  if (r.error) throw r.error;
  return (r.stdout || '').toString().trim();
}

// ── 오디오 라우팅 IPC ──────────────────────────────────────────────
// enable: 현재 기본 출력 저장 → TalkSync Virtual Audio Cable로 전환
ipcMain.handle('audio:enable-cable-routing', async () => {
  if (!ps1GetDefault) return { ok: false, reason: 'scripts not initialized' };
  try {
    const currentId = await psAsync(ps1GetDefault);
    if (!currentId) return { ok: false, reason: '현재 출력 장치 ID를 가져올 수 없습니다' };
    savedOutputDeviceId = currentId;

    const cableBId = await psAsync(ps1FindCableB);
    if (!cableBId) return { ok: false, reason: 'TalkSync Virtual Audio Cable 장치를 찾을 수 없습니다' };

    await psAsync(ps1SetDefault, ['-DeviceId', cableBId]);
    console.log('[audio] TalkSync 라우팅 활성화. 원래 장치:', currentId);
    return { ok: true };
  } catch (e) {
    console.error('[audio:enable-cable-routing]', e);
    return { ok: false, reason: String(e) };
  }
});

// disable: 저장된 원래 장치로 복원
ipcMain.handle('audio:disable-cable-routing', async () => {
  if (!savedOutputDeviceId) return { ok: false, reason: 'no saved device' };
  try {
    const id = savedOutputDeviceId;
    savedOutputDeviceId = null;
    await psAsync(ps1SetDefault, ['-DeviceId', id]);
    console.log('[audio] 원래 출력 장치 복원:', id);
    return { ok: true };
  } catch (e) {
    console.error('[audio:disable-cable-routing]', e);
    return { ok: false, reason: String(e) };
  }
});

// ── 앱 종료 시 자동 복원 ─────────────────────────────────────────
app.on('will-quit', (event) => {
  if (!savedOutputDeviceId || audioRestoringFlag) return;
  event.preventDefault();
  audioRestoringFlag = true;
  const id = savedOutputDeviceId;
  savedOutputDeviceId = null;
  psAsync(ps1SetDefault, ['-DeviceId', id])
    .catch((e) => console.error('[will-quit audio restore]', e))
    .finally(() => {
      audioRestoringFlag = false;
      app.quit();
    });
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
