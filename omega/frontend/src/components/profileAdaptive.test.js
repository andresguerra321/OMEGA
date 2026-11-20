import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolveVisibleNavItems } from '../lib/useTenantProfileConfig.js';

const BASE_NAV_ITEMS = [
  { id: 'inicio', label: 'Inicio' },
  { id: 'equipo', label: 'Equipos' },
  { id: 'exposicion', label: 'Enlaces y OSINT' },
  { id: 'amenazas', label: 'Amenazas' },
  { id: 'repo_scanner', label: 'Repositorios' },
  { id: 'preguntar', label: 'Asistente' },
  { id: 'cuenta', label: 'Cuenta y Ajustes' },
];

test('perfil DEVELOPER muestra repo_scanner y oculta módulos no listados manteniendo cuenta', () => {
  const visible = resolveVisibleNavItems(BASE_NAV_ITEMS, {
    profile: 'DEVELOPER',
    visibleModules: ['inicio', 'equipo', 'exposicion', 'amenazas', 'preguntar', 'repo_scanner', 'cuenta'],
  });
  const ids = visible.map((i) => i.id);
  assert.ok(ids.includes('repo_scanner'));
  assert.ok(ids.includes('cuenta'));
});

test('perfil LEGAL y GENERAL ocultan repo_scanner y conservan módulos estándar y cuenta', () => {
  const legal = resolveVisibleNavItems(BASE_NAV_ITEMS, {
    profile: 'LEGAL',
    visibleModules: ['inicio', 'equipo', 'exposicion', 'amenazas', 'preguntar', 'expedientes', 'cuenta'],
  });
  assert.equal(legal.some((i) => i.id === 'repo_scanner'), false);
  assert.ok(legal.some((i) => i.id === 'cuenta'));

  const general = resolveVisibleNavItems(BASE_NAV_ITEMS, {
    profile: 'GENERAL',
    visibleModules: ['inicio', 'equipo', 'exposicion', 'amenazas', 'preguntar', 'cuenta'],
  });
  assert.equal(general.some((i) => i.id === 'repo_scanner'), false);
  assert.ok(general.some((i) => i.id === 'inicio'));
  assert.ok(general.some((i) => i.id === 'cuenta'));
});

test('RepoScannerPanel nunca usa la frase "repo seguro" y conserva el mensaje honesto', () => {
  const src = readFileSync(new URL('./RepoScannerPanel.jsx', import.meta.url), 'utf8');
  assert.equal(/repo seguro/i.test(src), false);
  assert.ok(src.includes('Sin señales detectadas con las reglas actuales'));
});
