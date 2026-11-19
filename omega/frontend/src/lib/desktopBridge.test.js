import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectNativeHostSnapshot,
  detectDesktopRuntime,
  getBootstrapStatus,
  getDesktopRuntimeInfo,
  isDesktopApp,
} from './desktopBridge.js';

test('detectDesktopRuntime detects Tauri v2 natively and falls back to Web', () => {
  const tauriWin = { __TAURI_INTERNALS__: { invoke: async () => ({}) } };
  assert.equal(detectDesktopRuntime(tauriWin), 'tauri-v2');
  assert.equal(isDesktopApp(tauriWin), true);
  assert.equal(detectDesktopRuntime({}), 'web');
  assert.equal(isDesktopApp({}), false);
});

test('getDesktopRuntimeInfo, getBootstrapStatus, and collectNativeHostSnapshot invoke Tauri v2 IPC', async () => {
  const calls = [];
  const fakeWin = {
    __TAURI_INTERNALS__: {
      invoke: async (cmd) => {
        calls.push(cmd);
        if (cmd === 'get_desktop_runtime_info') {
          return { runtime: 'tauri-v2', deploymentMode: 'CLOUD_MANAGED', requiresDocker: false };
        }
        if (cmd === 'get_bootstrap_status') {
          return { phase: 'READY', requiresDocker: false };
        }
        return { sensor: 'omega-sensor-rust', process_count: 142 };
      },
    },
  };

  const info = await getDesktopRuntimeInfo(fakeWin);
  assert.equal(info.runtime, 'tauri-v2');
  assert.equal(info.requiresDocker, false);

  const boot = await getBootstrapStatus(fakeWin);
  assert.equal(boot.phase, 'READY');

  const snap = await collectNativeHostSnapshot(fakeWin);
  assert.equal(snap.ok, true);
  assert.equal(snap.snapshot.sensor, 'omega-sensor-rust');
  assert.deepEqual(calls, [
    'get_desktop_runtime_info',
    'get_bootstrap_status',
    'collect_host_telemetry_snapshot',
  ]);
});

test('web fallback returns CLOUD_MANAGED without Docker requirement', async () => {
  const info = await getDesktopRuntimeInfo({});
  assert.equal(info.runtime, 'web');
  assert.equal(info.deploymentMode, 'CLOUD_MANAGED');
  assert.equal(info.requiresDocker, false);
  assert.equal(await getBootstrapStatus({}), null);

  const snap = await collectNativeHostSnapshot({});
  assert.equal(snap.ok, false);
});
