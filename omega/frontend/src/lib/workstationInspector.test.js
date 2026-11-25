import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeWorkstationEntries,
  buildSimulatedStealerEntries,
} from './workstationInspector.js';

test('detecta vectores reales de robo de credenciales (tasks.json folderOpen, postinstall base64, .npmrc, .gitconfig store y .env sin ignorar) sin filtrar secretos', () => {
  const entries = buildSimulatedStealerEntries();
  const report = analyzeWorkstationEntries(entries, { scopeLabel: 'Simulación' });

  assert.equal(report.overallStatus, 'CRITICAL');
  assert.equal(report.controlsEvaluated, 6);
  assert.ok(report.criticalCount >= 3);

  const byId = Object.fromEntries(report.controls.map((c) => [c.controlId, c]));

  // DEV-WS-01 no tenía ~/.ssh en las entradas -> debe ser UNVERIFIED honesto, jamás PASS falso
  assert.equal(byId['DEV-WS-01'].status, 'UNVERIFIED');

  // DEV-WS-02 detecta .npmrc _authToken sin exponer el valor del token
  assert.equal(byId['DEV-WS-02'].status, 'WARN');
  assert.equal(JSON.stringify(report).includes('npm_simulated_placeholder_0000'), false);

  // DEV-WS-03 detecta credential.helper = store
  assert.equal(byId['DEV-WS-03'].status, 'WARN');

  // DEV-WS-04 detecta nombres GITHUB_TOKEN y OPENAI_API_KEY + falta de exclusión en .gitignore, sin incluir valores
  assert.equal(byId['DEV-WS-04'].status, 'WARN');
  assert.equal(byId['DEV-WS-04'].severity, 'CRITICAL');
  assert.equal(JSON.stringify(report).includes('ghp_simulated_token_value'), false);
  assert.equal(JSON.stringify(report).includes('sk_simulated_value'), false);
  assert.deepEqual(report.backendSyncPayload.exposedSensitiveEnvNames.sort(), ['GITHUB_TOKEN', 'OPENAI_API_KEY']);

  // DEV-WS-05 detecta "runOn": "folderOpen" en .vscode/tasks.json
  assert.equal(byId['DEV-WS-05'].status, 'WARN');
  assert.equal(byId['DEV-WS-05'].severity, 'CRITICAL');

  // DEV-WS-06 detecta postinstall con Buffer.from(..., 'base64')
  assert.equal(byId['DEV-WS-06'].status, 'WARN');
  assert.equal(byId['DEV-WS-06'].severity, 'CRITICAL');
});

test('proyecto limpio con .gitignore correcto marca PASS en controles verificados y UNVERIFIED en los ausentes', () => {
  const report = analyzeWorkstationEntries([
    {
      path: 'package.json',
      content: JSON.stringify({ name: 'clean-app', scripts: { test: 'node --test', build: 'vite build' } }),
    },
    {
      path: '.gitignore',
      content: 'node_modules/\n.env\n.env.*\n',
    },
    {
      path: '.git/config',
      content: '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = git@github.com:org/clean-app.git\n',
    },
  ]);

  assert.equal(report.overallStatus, 'PASS');
  assert.equal(report.warningsCount, 0);
  const byId = Object.fromEntries(report.controls.map((c) => [c.controlId, c]));
  assert.equal(byId['DEV-WS-01'].status, 'UNVERIFIED');
  assert.equal(byId['DEV-WS-02'].status, 'PASS');
  assert.equal(byId['DEV-WS-03'].status, 'PASS');
  assert.equal(byId['DEV-WS-04'].status, 'PASS');
  assert.equal(byId['DEV-WS-06'].status, 'PASS');
});

test('detecta llave privada PKCS#8 sin cifrar dentro de un repositorio sin exponer su contenido', () => {
  const fakePem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC\n-----END PRIVATE KEY-----\n';
  const report = analyzeWorkstationEntries([{ path: 'deploy/server.pem', content: fakePem }]);
  const ws01 = report.controls.find((c) => c.controlId === 'DEV-WS-01');
  assert.equal(ws01.status, 'WARN');
  assert.equal(ws01.severity, 'CRITICAL');
  assert.equal(JSON.stringify(report).includes('MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC'), false);
});
