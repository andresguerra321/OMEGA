import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectNativeHostSnapshot,
  detectDesktopRuntime,
  getBootstrapStatus,
  getDesktopRuntimeInfo,
  isDesktopApp,
  getMobileDesktopBridge,
} from './desktopBridge.js';

test('mobile desktop bridge forwards native commands and preserves device and backup arguments', async () => {
  const calls = [];
  const bridge = getMobileDesktopBridge({ __TAURI_INTERNALS__: {
    invoke: async (command, args) => { calls.push([command, args]); return { ok: true }; },
  } });
  const targets = [{ file_id: 'a'.repeat(40), relative_path: 'Library/SMS/sms.db' }];
  await bridge.checkAdbStatus('C:/tools/adb.exe');
  await bridge.checkIosStatus();
  await bridge.pickAdbBinary();
  await bridge.installPortableAdb();
  await bridge.collectDeviceSnapshot('C:/tools/adb.exe', 'android-2');
  await bridge.collectIosSnapshot('iphone-2');
  await bridge.pickIosBackupDir();
  await bridge.readIosBackupManifest('C:/backup');
  await bridge.readIosBackupArtifacts('C:/backup', true, targets);
  await bridge.hardenPrivateDns('C:/tools/adb.exe', 'android-2');
  assert.deepEqual(calls, [
    ['check_adb_status', { customPath: 'C:/tools/adb.exe' }],
    ['check_ios_status', {}], ['pick_adb_binary', {}], ['install_portable_adb', {}],
    ['collect_device_snapshot', { customPath: 'C:/tools/adb.exe', serial: 'android-2' }],
    ['collect_ios_snapshot', { udid: 'iphone-2' }], ['pick_ios_backup_dir', {}],
    ['read_ios_backup_manifest', { backupPath: 'C:/backup' }],
    ['read_ios_backup_artifacts', { backupPath: 'C:/backup', encrypted: true, targets }],
    ['harden_private_dns', { customPath: 'C:/tools/adb.exe', serial: 'android-2', confirmed: true }],
  ]);
  assert.equal(getMobileDesktopBridge({}), null);
  const broken = getMobileDesktopBridge({ __TAURI_INTERNALS__: { invoke: async () => { throw new Error('USB disconnected'); } } });
  await assert.rejects(broken.collectIosSnapshot('iphone-2'), /USB disconnected/);
});

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
