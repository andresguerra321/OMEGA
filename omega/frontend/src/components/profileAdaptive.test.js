import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolveVisibleNavItems } from '../lib/useTenantProfileConfig.js';

const BASE_NAV_ITEMS = [
  { id: 'inicio', label: 'Inicio' },
  { id: 'equipo', label: 'Equipos' },
  { id: 'exposicion', label: 'Enlaces y OSINT' },
  { id: 'amenazas', label: 'Amenazas' },
  { id: 'repo_scanner', label: 'Proyectos' },
  { id: 'dev_cli', label: 'CLI y CI' },
  { id: 'expedientes', label: 'Expedientes' },
  { id: 'seguridad_despacho', label: 'Seguridad' },
  { id: 'preguntar', label: 'Asistente' },
  { id: 'cuenta', label: 'Cuenta y Ajustes' },
];

test('perfil DEVELOPER muestra repo_scanner y exposicion, consolida GitHub en un solo módulo y oculta dev_cli', () => {
  const visible = resolveVisibleNavItems(BASE_NAV_ITEMS, {
    profile: 'DEVELOPER',
    visibleModules: ['repo_scanner', 'exposicion', 'amenazas', 'preguntar', 'cuenta'],
  });
  const ids = visible.map((i) => i.id);
  assert.ok(ids.includes('repo_scanner'));
  assert.ok(ids.includes('exposicion'));
  assert.ok(ids.includes('cuenta'));
  assert.equal(ids.includes('dev_cli'), false);
  assert.equal(ids.includes('equipo'), false);
});

test('perfil LEGAL y GENERAL ocultan repo_scanner y dev_cli y conservan módulos estándar y cuenta', () => {
  const legal = resolveVisibleNavItems(BASE_NAV_ITEMS, {
    profile: 'LEGAL',
    visibleModules: ['expedientes', 'preguntar', 'seguridad_despacho', 'cuenta'],
  });
  assert.equal(legal.some((i) => i.id === 'repo_scanner'), false);
  assert.equal(legal.some((i) => i.id === 'dev_cli'), false);
  assert.ok(legal.some((i) => i.id === 'cuenta'));
  assert.ok(legal.some((i) => i.id === 'expedientes'));
  assert.equal(legal.some((i) => i.id === 'amenazas'), false);

  const general = resolveVisibleNavItems(BASE_NAV_ITEMS, {
    profile: 'GENERAL',
    visibleModules: ['inicio', 'equipo', 'exposicion', 'amenazas', 'preguntar', 'cuenta'],
  });
  assert.equal(general.some((i) => i.id === 'repo_scanner'), false);
  assert.equal(general.some((i) => i.id === 'dev_cli'), false);
  assert.ok(general.some((i) => i.id === 'inicio'));
  assert.ok(general.some((i) => i.id === 'cuenta'));
});

test('la configuración real preserva GENERAL y DEVELOPER y abre LEGAL en expedientes', () => {
  const config = JSON.parse(readFileSync(new URL('../../../backend-java/src/main/resources/profile-configs.json', import.meta.url), 'utf8'));
  assert.equal(config.version, '1.1.0');
  assert.deepEqual(config.profiles.GENERAL, {
    visibleModules: ['inicio', 'equipo', 'exposicion', 'amenazas', 'preguntar', 'cuenta'],
    ragCorpusScope: 'general_cti', copilotTone: 'balanced_defensive',
    copilotInstructions: 'Mantén el enfoque defensivo estándar de OMEGA sobre spyware, CTI y verificación pasiva en lenguaje claro.',
    defaultView: 'inicio',
  });
  assert.deepEqual(config.profiles.DEVELOPER, {
    visibleModules: ['repo_scanner', 'inicio', 'exposicion', 'amenazas', 'preguntar', 'cuenta'],
    ragCorpusScope: 'dev_supply_chain_cti', copilotTone: 'technical_appsec',
    copilotInstructions: 'Usa tono técnico y directo enfocado en análisis de repositorios, dependencias, puntaje explicable y cadena de suministro. Nunca afirmes que un repositorio es seguro.',
    defaultView: 'repo_scanner',
  });
  assert.deepEqual(config.profiles.LEGAL.visibleModules, ['expedientes', 'preguntar', 'seguridad_despacho', 'cuenta']);
  assert.equal(config.profiles.LEGAL.defaultView, 'expedientes');
});

test('cuenta permanece visible aunque la configuración no la incluya', () => {
  assert.deepEqual(resolveVisibleNavItems(BASE_NAV_ITEMS, { visibleModules: ['expedientes'] }).map(item => item.id), ['expedientes', 'cuenta']);
});

test('RepoScannerPanel nunca usa la frase "repo seguro" y conserva el mensaje honesto', () => {
  const src = readFileSync(new URL('./RepoScannerPanel.jsx', import.meta.url), 'utf8');
  assert.equal(/repo seguro/i.test(src), false);
  assert.ok(src.includes('Sin señales detectadas con las reglas actuales'));
});

test('Hub Proyectos (RepoScannerPanel) consolida todas las pestañas comerciales de DEVELOPER sin habilitar dev_cli en navegación principal', () => {
  const panelSrc = readFileSync(new URL('./RepoScannerPanel.jsx', import.meta.url), 'utf8');
  for (const tabId of ['scan', 'projects', 'findings', 'sbom', 'policies', 'supply_chain', 'reports', 'cli', 'github']) {
    assert.ok(panelSrc.includes(`id: '${tabId}'`), `Falta pestaña ${tabId} en RepoScannerPanel`);
  }
  for (const compFile of [
    './DevProjectsTab.jsx',
    './DevFindingsTriageTab.jsx',
    './DevDependenciesSbomTab.jsx',
    './DevPoliciesTab.jsx',
    './DevSupplyChainIntelTab.jsx',
    './DevReportsTab.jsx',
  ]) {
    const cSrc = readFileSync(new URL(compFile, import.meta.url), 'utf8');
    assert.equal(/repo seguro/i.test(cSrc), false);
    assert.ok(cSrc.length > 500);
  }
});
