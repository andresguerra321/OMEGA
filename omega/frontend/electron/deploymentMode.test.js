import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEPLOYMENT_MODES,
  normalizeCloudApiOrigin,
  probeCloudBackendHealth,
  resolveDeploymentConfig,
} from './deploymentMode.js';

test('CLOUD_MANAGED mode disables Docker requirement when a valid HTTPS backend URL is provided', () => {
  const cfg = resolveDeploymentConfig({
    env: {
      OMEGA_DEPLOYMENT_MODE: 'CLOUD_MANAGED',
      OMEGA_CLOUD_API_URL: 'https://api.omega-shield.example/api/v1',
    },
  });
  assert.equal(cfg.mode, DEPLOYMENT_MODES.CLOUD_MANAGED);
  assert.equal(cfg.requiresDocker, false);
  assert.equal(cfg.cloudApiUrl, 'https://api.omega-shield.example');
});

test('CLOUD_MANAGED rejects insecure HTTP or embedded credentials and falls back to SELF_HOSTED', () => {
  assert.equal(normalizeCloudApiOrigin('http://api.omega.example'), null);
  assert.equal(normalizeCloudApiOrigin('https://user:pass@api.omega.example'), null);

  const cfg = resolveDeploymentConfig({
    env: {
      OMEGA_DEPLOYMENT_MODE: 'CLOUD_MANAGED',
      OMEGA_CLOUD_API_URL: 'http://insecure.example.com',
    },
  });
  assert.equal(cfg.mode, DEPLOYMENT_MODES.SELF_HOSTED);
  assert.equal(cfg.requiresDocker, true);
  assert.equal(cfg.cloudApiUrl, null);
});

test('persisted deployment-mode.json in userData enables CLOUD_MANAGED without env vars', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-deploy-mode-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'deployment-mode.json'),
      JSON.stringify({ mode: 'CLOUD_MANAGED', cloudApiUrl: 'https://cloud.omega.sec' }),
    );
    const cfg = resolveDeploymentConfig({ env: {}, userDataDir: tmpDir });
    assert.equal(cfg.mode, DEPLOYMENT_MODES.CLOUD_MANAGED);
    assert.equal(cfg.requiresDocker, false);
    assert.equal(cfg.cloudApiUrl, 'https://cloud.omega.sec');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('probeCloudBackendHealth checks /actuator/health over HTTPS with redirect error policy', async () => {
  const calls = [];
  const res = await probeCloudBackendHealth('https://cloud.omega.sec', {
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    },
  });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://cloud.omega.sec/actuator/health');
  assert.equal(calls[0].init.redirect, 'error');
});
