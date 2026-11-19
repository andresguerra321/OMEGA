import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectNativeHostSnapshot,
  detectDesktopRuntime,
  getDesktopRuntimeInfo,
} from './desktopBridge.js';

test('detectDesktopRuntime prefers Tauri v2, falls back to Electron, then Web', () => {
  assert.equal(detectDesktopRuntime({ __TAURI_INTERNALS__: { invoke: async () => ({}) } }), 'tauri-v2');
  assert.equal(detectDesktopRuntime({ omegaDesktop: {} }), 'electron');
  assert.equal(detectDesktopRuntime({}), 'web');
});

test('getDesktopRuntimeInfo and collectNativeHostSnapshot invoke Tauri v2 IPC', async () => {
  const calls = [];
  const fakeWin = {
    __TAURI_INTERNALS__: {
      invoke: async (cmd) => {
        calls.push(cmd);
        if (cmd === 'get_desktop_runtime_info') {
          return { runtime: 'tauri-v2', deploymentMode: 'CLOUD_MANAGED', requiresDocker: false };
        }
        return { sensor: 'omega-sensor-rust', process_count: 142 };
      },
    },
  };

  const info = await getDesktopRuntimeInfo(fakeWin);
  assert.equal(info.runtime, 'tauri-v2');
  assert.equal(info.requiresDocker, false);

  const snap = await collectNativeHostSnapshot(fakeWin);
  assert.equal(snap.ok, true);
  assert.equal(snap.snapshot.sensor, 'omega-sensor-rust');
  assert.deepEqual(calls, ['get_desktop_runtime_info', 'collect_host_telemetry_snapshot']);
});

test('web fallback returns CLOUD_MANAGED without Docker requirement', async () => {
  const info = await getDesktopRuntimeInfo({});
  assert.equal(info.runtime, 'web');
  assert.equal(info.deploymentMode, 'CLOUD_MANAGED');
  assert.equal(info.requiresDocker, false);

  const snap = await collectNativeHostSnapshot({});
  assert.equal(snap.ok, false);
});
