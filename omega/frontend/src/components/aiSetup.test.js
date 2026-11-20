import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { after, afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

const apiUrl = new URL('../lib/api.js', import.meta.url).href;
const jsxSources = new Map();
for (const name of ['AiSetupGate', 'TwoFactorSettingsCard', 'OmegaBrandMark']) {
  const url = new URL(`./${name}.jsx`, import.meta.url);
  jsxSources.set(url.href, (await transformWithOxc(await fs.readFile(url, 'utf8'), fileURLToPath(url), { jsx: { runtime: 'automatic' } })).code);
}
const api = {}; globalThis.__omegaSetupApi = api;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (jsxSources.has(context.parentURL) && specifier.startsWith('.')) return {url:new URL(specifier + (specifier === './TwoFactorSettingsCard' || specifier === './OmegaBrandMark' ? '.jsx' : '.js'), context.parentURL).href, shortCircuit:true};
    return next(specifier,context);
  },
  load(url,context,next) {
    if(jsxSources.has(url)) return {format:'module',source:jsxSources.get(url),shortCircuit:true};
    if(url === apiUrl) return {format:'module',source:['fetchSystemGovernance','testAiEngineConnection','fetchMfaStatus','setupTotpMfa','confirmTotpMfa','setupEmailMfa','confirmEmailMfa','disableMfa'].map(name => `export const ${name}=(...args)=>globalThis.__omegaSetupApi.${name}(...args);`).join('\n'),shortCircuit:true};
    return next(url,context);
  }
});
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://omega.test', pretendToBeVisual: true });
const previous = new Map();
for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
  Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement,
  Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { AiSetupGate } = await import('./AiSetupGate.jsx');
let root, container;
let saved = false, saves, probes, completed;
const ready = {configured:true, active_provider:'groq', active_model:'test-model'};
beforeEach(() => {
  window.localStorage.clear();
  saved=false; saves=0; probes=0; completed=0;
  api.fetchSystemGovernance=async()=>({ai_engine:saved?ready:{configured:false}});
  api.testAiEngineConnection=async()=>{probes++;return {ok:true};};
  api.fetchMfaStatus=async()=>({mfaEnabled:true,method:'TOTP'});
  window.__TAURI_INTERNALS__={invoke:async command=>{
    assert.equal(command,'save_desktop_runtime_config'); saves++;saved=true;return {ok:true};
  }};
  container=document.createElement('div'); document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
after(()=>{hooks.deregister();dom.window.close();delete globalThis.__omegaSetupApi;for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
async function render(props={}){await act(async()=>root.render(createElement(AiSetupGate,{enabled:true,accountId:'fixture-user',authSession:{userId:'fixture-user',email:'fixture@example.org'},onComplete:()=>completed++,...props},createElement('div',{'data-workspace':true},'workspace'))));}
const workspace=()=>container.querySelector('[data-workspace]');
const button=text=>[...container.querySelectorAll('button')].find(node=>node.textContent.includes(text));
async function click(text){assert.ok(button(text));await act(async()=>button(text).click());}
async function key(value){await act(async()=>{const node=container.querySelector('input');Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new window.Event('input',{bubbles:true}));});}
async function submit(){await act(async()=>container.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));}
async function settle(predicate){
  for(let attempt=0;attempt<300;attempt++){
    if(predicate())return;
    await act(async()=>new Promise(resolve=>setTimeout(resolve,10)));
  }
  assert.ok(predicate(),'The expected UI state did not become ready');
}

test('missing AI configuration blocks workspace and offers only sequential mandatory steps',async()=>{
  await render();assert.equal(workspace(),null);
  assert.equal(button('Omitir'),undefined);assert.equal(button('Entrar a OMEGA'),undefined);
  await act(async()=>window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(workspace(),null);
  await click('Configurar copiloto');assert.ok(container.querySelector('input[type=password]'));
  assert.equal(button('Conectar y continuar').disabled,true);
});
test('rejected key cannot be saved or bypass the gate',async()=>{
  api.testAiEngineConnection=async()=>({ok:false,message:'Clave rechazada'});
  await render();await click('Configurar copiloto');await key('gsk_test_only');await submit();
  assert.equal(saves,0);assert.equal(workspace(),null);assert.match(container.textContent,/Clave rechazada/);
});
test('valid key is saved, verified against the running backend, and needs final confirmation',async()=>{
  await render();await click('Configurar copiloto');await key('gsk_test_only');await submit();
  assert.equal(saves,1);assert.equal(probes,2);assert.equal(workspace(),null);
  assert.equal(container.querySelector('input'),null);
  await click('Entrar a OMEGA');assert.ok(workspace());assert.equal(completed,1);
});
test('failed configuration apply never opens workspace',async()=>{
  window.__TAURI_INTERNALS__.invoke=async()=>({ok:false});
  await render();await click('Configurar copiloto');await key('gsk_test_only');await submit();
  assert.equal(workspace(),null);assert.equal(container.querySelector('input').value,'');
  assert.match(container.textContent,/no pudo aplicar/);
});
test('existing configured installations enter normally but new accounts still complete setup',async()=>{
  window.localStorage.setItem('omega_ai_setup_v2:fixture-user','complete');
  saved=true;await render();assert.ok(workspace());
  await render({forceSetup:true});assert.equal(workspace(),null);
  await click('Configurar copiloto');await click('Comprobar configuraci');assert.equal(workspace(),null);
  await click('Entrar a OMEGA');assert.ok(workspace());
});
test('reopening setup before confirmation cannot skip the last step and completion is per account',async()=>{
  saved=true;await render();await click('Configurar copiloto');await click('Comprobar configuraci');
  await render({key:'reopened'});assert.equal(workspace(),null);
  await click('Configurar copiloto');await click('Comprobar configuraci');await click('Entrar a OMEGA');
  await render({key:'completed'});assert.ok(workspace());
  await render({key:'other-account',accountId:'other-user'});assert.equal(workspace(),null);
});
test('without 2FA neither an old completion marker nor a connected model can open workspace',async()=>{
  saved=true; api.fetchMfaStatus=async()=>({mfaEnabled:false,smtpConfigured:true});
  window.localStorage.setItem('omega_ai_setup_v2:fixture-user','complete');
  await render();assert.equal(workspace(),null);
  await click('Configurar copiloto');await click('Comprobar configuraci');
  assert.equal(button('Entrar a OMEGA').disabled,true);assert.equal(workspace(),null);
});

test('authenticator enrollment keeps entry blocked until OTP confirmation and backup-code acknowledgment',async()=>{
  let active=false;
  api.fetchMfaStatus=async()=>({mfaEnabled:active,smtpConfigured:true});
  api.setupTotpMfa=async()=>({secret:'JBSWY3DPEHPK3PXP',otpauthUri:'otpauth://totp/OMEGA:fixture?secret=JBSWY3DPEHPK3PXP&issuer=OMEGA'});
  api.confirmTotpMfa=async code=>{assert.equal(code,'123456');active=true;return {method:'TOTP',backupCodes:['recovery-fixture']};};
  await render();await click('Configurar copiloto');await key('gsk_test_only');await submit();
  await act(async()=>container.querySelector('[role="switch"]').click());
  const portalButton=text=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
  await act(async()=>portalButton('Continuar').click());
  await settle(()=>document.querySelector('img[alt="Código QR 2FA"]'));
  assert.ok(document.querySelector('img[alt="Código QR 2FA"]'));
  const pasted=new window.Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(pasted,'clipboardData',{value:{getData:()=> '123456'}});
  await act(async()=>document.querySelector('input[aria-label="Dígito 2FA 1 de 6"]').dispatchEvent(pasted));
  await act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(button('Entrar a OMEGA').disabled,true);
  assert.equal(document.querySelector('button[aria-label="Cerrar"]').disabled,true);
  await act(async()=>portalButton('Ya guardé los códigos').click());
  await act(async()=>portalButton('Listo').click());
  assert.equal(button('Entrar a OMEGA').disabled,false);
  await click('Entrar a OMEGA');assert.ok(workspace());
});

test('failed readiness checks block workspace while signed-out users retain login',async()=>{
  api.fetchSystemGovernance=async()=>{throw new Error('offline');};
  await render();assert.equal(workspace(),null);assert.ok(button('Reintentar'));
  await render({enabled:false});assert.ok(workspace());
});
