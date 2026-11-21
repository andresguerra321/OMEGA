import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement, act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

test('navegación por perfil y estados reales de Expedientes', async (t) => {
  const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  t.after(() => server.close());
  const browser = new JSDOM('<div id="root"></div>', { url: 'file:///omega.html' });
  const saved = Object.fromEntries(['window', 'document', 'fetch', 'CustomEvent', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, globalThis[key]]));
  let root;
  try {
    globalThis.window = browser.window;
    globalThis.document = browser.window.document;
    globalThis.CustomEvent = browser.window.CustomEvent;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const { SpatialNavPill } = await server.ssrLoadModule('/src/components/SpatialNavPill.jsx');
    const { profiles } = JSON.parse(readFileSync(new URL('../../../backend-java/src/main/resources/profile-configs.json', import.meta.url), 'utf8'));
    for (const [profile, config] of Object.entries(profiles)) {
      const html = renderToStaticMarkup(createElement(SpatialNavPill, { visibleModuleIds: config.visibleModules, activeNav: config.defaultView }));
      const dom = new JSDOM(html);
      const labels = [...dom.window.document.querySelectorAll('button')].map(button => button.getAttribute('aria-label'));
      assert.equal(labels.includes('Expedientes'), profile === 'LEGAL');
      assert.equal(labels.some(label => label?.startsWith('Amenazas')), profile !== 'LEGAL');
      assert.equal(labels.some(label => label?.startsWith('Cuenta')), true);
      assert.equal(labels.some(label => label?.startsWith('CLI')), false);
      assert.equal(labels.some(label => label?.startsWith('Seguridad')), false);
      if (profile === 'LEGAL') assert.match(html, /aria-current="page"/);
      dom.window.close();
    }
    const { ChatWorkspace } = await server.ssrLoadModule('/src/components/ChatWorkspace.jsx');
    const chatHtml = renderToStaticMarkup(createElement(ChatWorkspace, { privateOnly: true, usePrivateDocs: true,
      disclaimer: 'No es asesoría legal.', messages: [], allConversationCitations: [], loading: false }));
    const chatDom = new JSDOM(chatHtml);
    assert.match(chatDom.window.document.querySelector('[role="note"]').textContent, /No es asesoría legal/);
    const visibleButtons = [...chatDom.window.document.querySelectorAll('button')].filter(button => !button.hidden);
    assert.equal(visibleButtons.some(button => button.textContent.includes('Corpus CTI')), false);
    chatDom.window.close();

    let finishRequest;
    const policy = { fingerprint: 'a'.repeat(64), accepted: true, canAccept: false,
      disclosure: { indexing: { provider: 'LOCAL_TEXT', model: 'lexical-only-tsvector', destination: 'LOCAL' }, responses: [{ provider: 'GROQ', model: 'synthetic-model', destination: 'https://api.groq.com' }] } };
    const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    globalThis.fetch = url => String(url).endsWith('/policy') ? Promise.resolve(json(policy)) : new Promise(resolve => { finishRequest = resolve; });
    const { ExpedientesPanel } = await server.ssrLoadModule('/src/components/ExpedientesPanel.jsx');
    const emptyPage = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
    const findButton = text => [...document.querySelectorAll('button')].find(button => button.textContent.includes(text));
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(createElement(ExpedientesPanel, { authSession: { role: 'ADMIN' } })));
    assert.match(document.querySelector('[aria-busy="true"]').textContent, /Cargando/);
    await act(async () => finishRequest(new Response('{}', { status: 500 })));
    assert.match(document.querySelector('[role="alert"]').textContent, /No pudimos cargar/);
    await act(async () => findButton('Reintentar').click());
    assert.match(document.querySelector('[aria-busy="true"]').textContent, /Cargando/);
    await act(async () => finishRequest(json(emptyPage)));
    assert.match(document.body.textContent, /No hay expedientes para mostrar/);
    await act(async () => findButton('Nuevo expediente').click());
    assert.equal(document.querySelector('[role="dialog"] input'), document.activeElement);
    await act(async () => findButton('Cancelar').click());
    assert.equal(document.querySelector('[role="dialog"]'), null);
    const synthetic = { id: 'case', title: 'Caso sintético', status: 'OPEN', classification: 'CONFIDENTIAL', canWrite: true, canManagePermissions: true, createdAt: '2026-11-20T12:00:00Z' };
    globalThis.fetch = async url => String(url).endsWith('/policy') ? json(policy) : String(url).endsWith('/metadata') ? json(synthetic) : json({ ...emptyPage, content: [synthetic], totalElements: 1, totalPages: 1 });
    await act(async () => root.render(createElement(ExpedientesPanel, { key: 'otro-tenant' })));
    assert.match(document.querySelector('ul').textContent, /Caso sintético/);
    assert.match(document.body.textContent, /no ofrece asesoría legal/);
    assert.match(document.body.textContent, /Se queda en tu equipo/);
    assert.match(document.body.textContent, /Sale a: Groq/);
    globalThis.fetch = async url => String(url).endsWith('/policy') ? json(policy) : String(url).endsWith('/metadata') ? json(synthetic) : json(emptyPage);
    await act(async () => findButton('Caso sintético').click());
    assert.equal(document.querySelectorAll('[role="tab"]').length, 5);
    assert.ok(document.getElementById('legal-tab-timeline'));
    assert.match(document.body.textContent, /aún no tiene documentos/);
    await act(async () => document.querySelector('[role="tab"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    assert.equal(document.activeElement.id, 'legal-tab-assistant');
    assert.match(document.body.textContent, /Consulta únicamente/);
    policy.accepted = false; policy.canAccept = true;
    let acceptedHash;
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/consent')) { acceptedHash = JSON.parse(options.body).fingerprint; policy.accepted = true; return new Response(null, { status: 204 }); }
      return String(url).endsWith('/policy') ? json(policy) : json(emptyPage);
    };
    await act(async () => root.render(createElement(ExpedientesPanel, { key: 'admin' })));
    await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent.includes('Acepto')).click());
    assert.equal(acceptedHash, policy.fingerprint);
    assert.match(document.body.textContent, /Política aceptada/);
    const { LegalDocumentsPanel } = await server.ssrLoadModule('/src/components/LegalDocumentsPanel.jsx');
    const doc = { id: 'doc', originalFilename: 'synthetic.pdf', sha256Hash: 'a'.repeat(64), totalPages: 1, status: 'INDEXED', ocrApplied: false, tempDeletedAt: '2026-11-20T12:00:00Z' };
    let deleted = false;
    globalThis.fetch = async (url, options) => {
      if (options?.method === 'DELETE') { deleted = true; return new Response(null, { status: 204 }); }
      if (String(url).includes('/text?')) return json({ fragments: [{ id: 'fragment', order: 0, text: 'Texto sintético extraído.' }] });
      if (String(url).endsWith('/detail')) return json({ metadata: doc, format: 'PDF' });
      return json({ ...emptyPage, content: deleted ? [] : [{ metadata: doc }], totalElements: deleted ? 0 : 1, totalPages: 1 });
    };
    await act(async () => root.render(createElement(LegalDocumentsPanel, { key: 'docs', value: synthetic, role: 'ANALYST', policyAccepted: true })));
    await act(async () => findButton('synthetic.pdf').click());
    assert.match(document.body.textContent, /Texto sintético extraído/);
    assert.match(document.body.textContent, /no es una firma/);
    await act(async () => findButton('Eliminar documento').click());
    assert.equal(deleted, false);
    await act(async () => findButton('Confirmar eliminación').click());
    assert.equal(deleted, true);
    assert.match(document.body.textContent, /aún no tiene documentos/);
  } finally {
    if (root) await act(async () => root.unmount());
    Object.assign(globalThis, saved);
    browser.window.close();
  }
});
