import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

test('ficha del caso y alerta orientativa no bloqueante de posible conflicto en Legal', async (t) => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'omega-legal-vite-'));
  const server = await createServer({
    configFile: false,
    cacheDir,
    optimizeDeps: { noDiscovery: true },
    plugins: [react()],
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  t.after(async () => {
    await server.close();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  const browser = new JSDOM('<div id="root"></div>', { url: 'file:///omega.html' });
  const saved = Object.fromEntries(
    ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'fetch', 'CustomEvent', 'Event', 'IS_REACT_ACT_ENVIRONMENT']
      .map(key => [key, globalThis[key]])
  );

  let root, act;
  try {
    globalThis.window = browser.window;
    globalThis.document = browser.window.document;
    globalThis.HTMLElement = browser.window.HTMLElement;
    globalThis.HTMLInputElement = browser.window.HTMLInputElement;
    globalThis.HTMLSelectElement = browser.window.HTMLSelectElement;
    globalThis.HTMLTextAreaElement = browser.window.HTMLTextAreaElement;
    globalThis.CustomEvent = browser.window.CustomEvent;
    globalThis.Event = browser.window.Event;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;

    const ReactMod = await import('react');
    const ReactDomClient = await import('react-dom/client');
    const { createElement } = ReactMod;
    act = ReactMod.act;
    const { createRoot } = ReactDomClient;

    const policy = {
      fingerprint: 'b'.repeat(64),
      accepted: true,
      canAccept: false,
      disclosure: {
        indexing: { provider: 'LOCAL_TEXT', model: 'lexical-only-tsvector', destination: 'LOCAL' },
        responses: [],
      },
    };
    const emptyPage = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
    const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

    const createdPayloads = [];
    const conflictUrls = [];
    let savedCase = null;

    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith('/policy')) return json(policy);
      if (target.includes('/legal/conflicts?')) {
        conflictUrls.push(target);
        return json({
          totalMatches: 2,
          restrictedMatches: 1,
          matches: [
            {
              code: 'RAD-2026-009',
              title: 'Litigio Comercial Previo',
              roles: ['COUNTERPARTY'],
            },
          ],
        });
      }
      if (target.endsWith('/expedientes/full') && options.method === 'POST') {
        const body = JSON.parse(options.body);
        createdPayloads.push(body);
        savedCase = {
          id: 'case-ficha-1',
          ...body,
          canWrite: true,
          canManagePermissions: true,
          createdAt: '2026-11-26T12:00:00Z',
          updatedAt: '2026-11-26T12:00:00Z',
        };
        return new Response(JSON.stringify(savedCase), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/case-ficha-1/metadata')) {
        return json(savedCase);
      }
      if (target.includes('/expedientes/page?')) {
        const list = savedCase ? [savedCase] : [];
        return json({ ...emptyPage, content: list, totalElements: list.length, totalPages: list.length ? 1 : 0 });
      }
      return json(emptyPage);
    };

    const { ExpedientesPanel } = await server.ssrLoadModule('/src/components/ExpedientesPanel.jsx');
    const setInputValue = (element, value) => {
      element.focus();
      Object.getOwnPropertyDescriptor(browser.window.HTMLInputElement.prototype, 'value').set.call(element, value);
      element.dispatchEvent(new browser.window.Event('input', { bubbles: true }));
    };
    const setSelectValue = (element, value) => {
      element.focus();
      Object.getOwnPropertyDescriptor(browser.window.HTMLSelectElement.prototype, 'value').set.call(element, value);
      element.dispatchEvent(new browser.window.Event('change', { bubbles: true }));
    };
    const findButton = text => [...document.querySelectorAll('button')].find(button => button.textContent.includes(text));

    root = createRoot(document.getElementById('root'));
    await act(async () => {
      root.render(createElement(ExpedientesPanel, { authSession: { role: 'ADMIN', userId: 'u-1' } }));
    });

    await act(async () => {
      findButton('Nuevo expediente').click();
    });

    const dialog = document.querySelector('[role="dialog"]');
    assert.ok(dialog);
    const titleInput = dialog.querySelector('input[name="title"]');
    const referenceInput = dialog.querySelector('input[name="reference"]');
    const clientInput = dialog.querySelector('input[name="clientName"]');
    const counterpartyInput = dialog.querySelector('input[name="counterpartyName"]');
    const courtInput = dialog.querySelector('input[name="courtName"]');
    const processSelect = dialog.querySelector('select[name="processType"]');
    const stageInput = dialog.querySelector('input[name="caseStage"]');

    assert.ok(clientInput && counterpartyInput && courtInput && processSelect && stageInput);

    // Editar cliente dispara comprobación orientativa sin bloquear guardado
    await act(async () => {
      setInputValue(titleInput, '  Demanda Contractual Ávila  ');
      setInputValue(referenceInput, '  11001-2026-0045  ');
      setInputValue(clientInput, '  Constructora Ávila S.A.S.  ');
      setInputValue(counterpartyInput, '  Banco Mercantil  ');
      setInputValue(courtInput, '  Juzgado 12 Civil del Circuito  ');
      setSelectValue(processSelect, 'COMERCIAL');
      setInputValue(stageInput, '  Contestación de demanda  ');
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 300));
    });

    assert.ok(conflictUrls.length >= 1);
    assert.match(dialog.textContent, /Posible conflicto de intereses\. Es una alerta orientativa; verifícala\./);
    assert.match(dialog.textContent, /RAD-2026-009 · Litigio Comercial Previo/);
    assert.match(dialog.textContent, /Contraparte/);
    assert.match(dialog.textContent, /1 coincidencia adicional en un expediente sin permiso de lectura\./);

    const saveButton = findButton('Guardar expediente');
    assert.equal(saveButton.disabled, false);

    // Guardar mantiene aviso no bloqueante y muestra la ficha del caso en el detalle
    await act(async () => {
      saveButton.click();
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
    });

    assert.equal(createdPayloads.length, 1);
    assert.deepEqual(createdPayloads[0], {
      title: 'Demanda Contractual Ávila',
      classification: 'CONFIDENTIAL',
      description: '',
      reference: '11001-2026-0045',
      status: 'OPEN',
      clientName: 'Constructora Ávila S.A.S.',
      counterpartyName: 'Banco Mercantil',
      courtName: 'Juzgado 12 Civil del Circuito',
      processType: 'COMERCIAL',
      caseStage: 'Contestación de demanda',
    });

    const ficha = document.querySelector('dl[aria-label="Ficha del caso"]');
    assert.ok(ficha);
    assert.match(ficha.textContent, /Constructora Ávila S\.A\.S\./);
    assert.match(ficha.textContent, /Banco Mercantil/);
    assert.match(ficha.textContent, /Juzgado 12 Civil del Circuito/);
    assert.match(ficha.textContent, /Comercial/);
    assert.match(ficha.textContent, /Contestación de demanda/);
    assert.match(document.body.textContent, /Posible conflicto de intereses\. Es una alerta orientativa; verifícala\./);
  } finally {
    if (root) await act(async () => root.unmount());
    Object.assign(globalThis, saved);
    browser.window.close();
  }
});
