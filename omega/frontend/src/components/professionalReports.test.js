import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { after, afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

const urls = ['ProfessionalReportsPanel', 'CommercialDocumentsPanel', 'AnalysisHistoryPanel'].map(name => new URL(`./${name}.jsx`, import.meta.url));
const transformed = new Map();
for (const url of urls) transformed.set(url.href, (await transformWithOxc(await fs.readFile(url, 'utf8'), fileURLToPath(url), { jsx: { runtime: 'automatic' } })).code);
const apiUrl = new URL('./__reports_api_mock__.js', import.meta.url).href;
const selectUrl = new URL('./__reports_select_mock__.js', import.meta.url).href;
globalThis.__omegaReportApi = {};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (transformed.has(context.parentURL) && specifier === '../lib/api') return { url: apiUrl, shortCircuit: true };
    if (transformed.has(context.parentURL) && specifier === './OmegaSelect') return { url: selectUrl, shortCircuit: true };
    if (transformed.has(context.parentURL) && specifier === './AnalysisHistoryPanel') return { url: urls[2].href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (transformed.has(url)) return { format: 'module', source: transformed.get(url), shortCircuit: true };
    if (url === apiUrl) return { format: 'module', source: ['apiFetch', 'listDevProjects', 'listExpedientes'].map(name => `export const ${name}=(...args)=>globalThis.__omegaReportApi.${name}(...args);`).join('\n'), shortCircuit: true };
    if (url === selectUrl) return { format: 'module', source: 'import {createElement} from "react"; export const OmegaSelect=props=>createElement("select",props);', shortCircuit: true };
    return next(url, context);
  },
});
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://omega.test' });
const previous = new Map();
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ProfessionalReportsPanel } = await import('./ProfessionalReportsPanel.jsx');
const { CommercialDocumentsPanel } = await import('./CommercialDocumentsPanel.jsx');
const { AnalysisHistoryPanel } = await import('./AnalysisHistoryPanel.jsx');
let root, container, calls;
beforeEach(() => {
  calls = [];
  globalThis.__omegaReportApi.listExpedientes = async () => [{ id: 'case-one', title: 'Caso propio' }];
  globalThis.__omegaReportApi.listDevProjects = async () => [];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
after(() => {
  hooks.deregister(); dom.window.close(); delete globalThis.__omegaReportApi;
  for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
});
test('report generation uses the selected case and lists the saved version without starting a scan', async () => {
  let saved = false;
  globalThis.__omegaReportApi.apiFetch = async (path, options = {}) => {
    calls.push({ path, options });
    if (options.method === 'POST') { saved = true; return { id: 'report-one' }; }
    return saved ? [{ id: 'report-one', title: 'Informe documental', profile: 'LEGAL', created_at: '2026-11-24T12:00:00Z', pdf_sha256: 'abc' }] : [];
  };
  await act(async () => root.render(createElement(ProfessionalReportsPanel, { profile: 'LEGAL', activeExpedienteId: 'case-one' })));
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === 'Generar informe');
  await act(async () => button.click());
  assert.deepEqual(calls.find(item => item.options.method === 'POST'), { path: '/reports', options: { method: 'POST', body: { profile: 'LEGAL', expedienteId: 'case-one', projectId: null } } });
  assert.match(container.textContent, /report-one/);
  assert.match(container.textContent, /0 créditos/);
  assert.equal(calls.some(item => /scan|extract|query/.test(item.path)), false);
});
test('registration consent is an explicit unselected choice for the current version', async () => {
  let version = null;
  globalThis.__omegaReportApi.apiFetch = async () => ({ published: true, version: 'version-one', documents: { terms: 'Términos', privacy: 'Privacidad' } });
  await act(async () => root.render(createElement(CommercialDocumentsPanel, { registration: true, onRegistrationConsent: value => { version = value; } })));
  const button = container.querySelector('[aria-pressed]');
  assert.equal(button.getAttribute('aria-pressed'), 'false'); assert.equal(version, null);
  await act(async () => button.click());
  assert.equal(version, 'version-one');
  await act(async () => button.click());
  assert.equal(version, null);
});
test('changing the evidence workspace never displays the previous case while loading', async () => {
  let finish;
  globalThis.__omegaReportApi.apiFetch = async path => path.includes('case-one')
    ? { items: [{ id: 'evaluation-one', operation: 'PC_LIVE', created_at: '2026-11-25T10:00:00Z', result: { observations: { diagnosis: { rationale: 'PRIVATE_CASE_ONE' } } } }], canWrite: false }
    : new Promise(resolve => { finish = resolve; });
  await act(async () => root.render(createElement(AnalysisHistoryPanel, { caseId: 'case-one' })));
  assert.match(container.textContent, /PRIVATE_CASE_ONE/);
  await act(async () => root.render(createElement(AnalysisHistoryPanel, { caseId: 'case-two' })));
  assert.doesNotMatch(container.textContent, /PRIVATE_CASE_ONE/);
  await act(async () => finish({ items: [], canWrite: false }));
  assert.match(container.textContent, /Sin evaluaciones/);
});
