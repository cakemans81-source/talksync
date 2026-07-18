/**
 * Isolation hard-gate tests against the REAL production module.
 * Run: node src/lib/isolationHardGate.test.mjs
 *
 * Compiles isolationHardGate.ts + audioDeviceBinding.ts via tsc (no tsx dep),
 * then asserts evaluateIsolationHardGate / isolationGateDisabledReason.
 */

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const outDir = mkdtempSync(join(tmpdir(), 'isolation-gate-'));
let failed = 0;

function assert(name, cond) {
  if (!cond) {
    console.error('FAIL:', name);
    failed += 1;
  } else {
    console.log('PASS:', name);
  }
}

try {
  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      join(__dirname, 'isolationHardGate.ts'),
      join(__dirname, 'audioDeviceBinding.ts'),
      '--outDir',
      outDir,
      '--module',
      'commonjs',
      '--target',
      'es2020',
      '--lib',
      'es2020,dom',
      '--skipLibCheck',
      '--esModuleInterop',
    ],
    { stdio: 'pipe' }
  );

  // eslint-disable-next-line import/no-dynamic-require
  const gate = require(join(outDir, 'isolationHardGate.js'));
  const { evaluateIsolationHardGate, isolationGateDisabledReason } = gate;

  const talksyncOut = {
    deviceId: 'out-ts',
    kind: 'audiooutput',
    label: 'TalkSync Speaker (Rx)',
  };
  const talksyncIn = {
    deviceId: 'in-ts',
    kind: 'audioinput',
    label: 'TalkSync Microphone (Tx)',
  };
  const ear = {
    deviceId: 'ear-1',
    kind: 'audiooutput',
    label: 'Headphones (Realtek)',
  };
  const mic = {
    deviceId: 'mic-1',
    kind: 'audioinput',
    label: 'Microphone Array',
  };
  const vbOut = {
    deviceId: 'vb-out',
    kind: 'audiooutput',
    label: 'CABLE Input (VB-Audio Virtual Cable)',
  };
  const speaker = {
    deviceId: 'spk-1',
    kind: 'audiooutput',
    label: 'Speakers (Realtek)',
  };

  // A1 — happy path
  {
    const r = evaluateIsolationHardGate({
      scanState: 'ready',
      bindingMode: 'exact-talksync',
      inputs: [mic, talksyncIn],
      outputs: [ear, talksyncOut],
      micDeviceId: mic.deviceId,
      virtualMicDeviceId: talksyncOut.deviceId,
      earphoneDeviceId: ear.deviceId,
    });
    assert('exact-talksync ready passes', r.ok === true);
    assert('happy path all checks green', r.checks.every((c) => c.pass));
  }

  // A2 — virtual earphone blocked
  {
    const r = evaluateIsolationHardGate({
      scanState: 'ready',
      bindingMode: 'exact-talksync',
      inputs: [mic, talksyncIn],
      outputs: [talksyncOut, vbOut],
      micDeviceId: mic.deviceId,
      virtualMicDeviceId: talksyncOut.deviceId,
      earphoneDeviceId: vbOut.deviceId,
    });
    assert(
      'virtual earphone blocked',
      r.ok === false && r.blockers.some((b) => b.code === 'earphone_virtual')
    );
  }

  // A3 — default earphone blocked
  {
    const r = evaluateIsolationHardGate({
      scanState: 'ready',
      bindingMode: 'exact-talksync',
      inputs: [mic, talksyncIn],
      outputs: [ear, talksyncOut],
      micDeviceId: mic.deviceId,
      virtualMicDeviceId: talksyncOut.deviceId,
      earphoneDeviceId: 'default',
    });
    assert(
      'default earphone blocked',
      r.ok === false && r.blockers.some((b) => b.code === 'earphone_unset')
    );
  }

  // A4 — generic VB-Cable alone blocked
  {
    const r = evaluateIsolationHardGate({
      scanState: 'ready',
      bindingMode: 'generic-fallback',
      inputs: [mic],
      outputs: [ear, vbOut],
      micDeviceId: mic.deviceId,
      virtualMicDeviceId: vbOut.deviceId,
      earphoneDeviceId: ear.deviceId,
    });
    assert(
      'generic VB-Cable alone blocked',
      r.ok === false && r.blockers.some((b) => b.code === 'pair_not_exact')
    );
  }

  // A5 — no-cable blocked
  {
    const r = evaluateIsolationHardGate({
      scanState: 'no-cable',
      bindingMode: 'missing',
      inputs: [mic],
      outputs: [ear],
      micDeviceId: mic.deviceId,
      virtualMicDeviceId: 'default',
      earphoneDeviceId: ear.deviceId,
    });
    assert(
      'no-cable blocked',
      r.ok === false && r.blockers.some((b) => b.code === 'missing_driver')
    );
    assert(
      'missing_driver checklist driver_pair is red',
      r.checks.find((c) => c.id === 'driver_pair')?.pass === false
    );
  }

  // A6 — enumeration race: empty device list still passes when exact-talksync ready
  {
    const r = evaluateIsolationHardGate({
      scanState: 'ready',
      bindingMode: 'exact-talksync',
      inputs: [],
      outputs: [],
      micDeviceId: mic.deviceId,
      virtualMicDeviceId: talksyncOut.deviceId,
      earphoneDeviceId: ear.deviceId,
    });
    assert('ready race with empty device list passes', r.ok === true);
  }

  // B1 — stale earphone id when list is populated
  {
    const r = evaluateIsolationHardGate({
      scanState: 'ready',
      bindingMode: 'exact-talksync',
      inputs: [mic, talksyncIn],
      outputs: [talksyncOut, speaker],
      micDeviceId: mic.deviceId,
      virtualMicDeviceId: talksyncOut.deviceId,
      earphoneDeviceId: 'ear-1',
    });
    assert(
      'stale earphone blocked',
      r.ok === false && r.blockers.some((b) => b.code === 'earphone_missing')
    );
  }

  // B2 — stale virtual Tx id when list is populated (AI leak risk)
  {
    const r = evaluateIsolationHardGate({
      scanState: 'ready',
      bindingMode: 'exact-talksync',
      inputs: [mic, talksyncIn],
      outputs: [ear, speaker],
      micDeviceId: mic.deviceId,
      virtualMicDeviceId: 'out-ts',
      earphoneDeviceId: ear.deviceId,
    });
    assert(
      'stale virtual Tx blocked',
      r.ok === false && r.blockers.some((b) => b.code === 'virtual_tx_missing')
    );
  }

  // B3 — TalkSync pair exists but selected Tx is generic VB-Cable
  {
    const r = evaluateIsolationHardGate({
      scanState: 'ready',
      bindingMode: 'exact-talksync',
      inputs: [mic, talksyncIn],
      outputs: [ear, talksyncOut, vbOut],
      micDeviceId: mic.deviceId,
      virtualMicDeviceId: vbOut.deviceId,
      earphoneDeviceId: ear.deviceId,
    });
    assert(
      'generic Tx with system TalkSync pair blocked',
      r.ok === false &&
        r.blockers.some((b) => b.code === 'pair_not_exact') &&
        r.checks.find((c) => c.id === 'driver_pair')?.pass === false
    );
  }

  // disabled reason helper
  {
    const r = evaluateIsolationHardGate({
      scanState: 'scanning',
      bindingMode: 'missing',
      inputs: [],
      outputs: [],
      micDeviceId: 'default',
      virtualMicDeviceId: 'default',
      earphoneDeviceId: 'default',
    });
    const reason = isolationGateDisabledReason(r);
    assert('disabled reason non-empty when blocked', reason.length > 0);
  }

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed`);
    process.exitCode = 1;
  } else {
    console.log('\nAll isolation hard-gate tests passed (real module)');
  }
} catch (err) {
  console.error('TEST HARNESS ERROR:', err instanceof Error ? err.message : err);
  if (err?.stdout) console.error(String(err.stdout));
  if (err?.stderr) console.error(String(err.stderr));
  process.exitCode = 1;
} finally {
  if (existsSync(outDir)) {
    try {
      rmSync(outDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
