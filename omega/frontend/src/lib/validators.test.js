import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  sanitizeSearchInput,
  validateAuthLoginForm,
  validateAuthRegisterForm,
  validateChatMessage,
  validateDomain,
  validateEmail,
  validateFullName,
  validateIocInput,
  validateIocList,
  validateNewPassword,
  validateOrganizationName,
  validateTenantSlug,
  validateUploadFile,
  validateUrlInput,
} from './validators.js';

test('validateEmail rechaza formatos incompletos y acepta correos válidos', () => {
  assert.equal(validateEmail('barrabasadas').valid, false);
  assert.equal(validateEmail('abc@localhost').valid, false);
  assert.equal(validateEmail('a@b').valid, false);
  assert.equal(validateEmail('foo..bar@dominio.org').valid, false);
  assert.equal(validateEmail('<script>@dominio.org').valid, false);

  const ok = validateEmail('  Camila.Vega+cti@redaccion.org  ');
  assert.equal(ok.valid, true);
  assert.equal(ok.value, 'camila.vega+cti@redaccion.org');
});

test('validateFullName bloquea números, símbolos y repeticiones; acepta nombres reales con tildes y apóstrofos', () => {
  assert.equal(validateFullName('123456').valid, false);
  assert.equal(validateFullName('Juan 123').valid, false);
  assert.equal(validateFullName('@@@@').valid, false);
  assert.equal(validateFullName('<script>alert(1)</script>').valid, false);
  assert.equal(validateFullName('aaaaaa').valid, false);
  assert.equal(validateFullName('a').valid, false);
  assert.equal(validateFullName('...').valid, false);

  assert.equal(validateFullName('Camila Vega').valid, true);
  assert.equal(validateFullName("María José O'Connor-Ruiz").valid, true);
  assert.equal(validateFullName('Dr. Ana Peña').valid, true);
});

test('validateOrganizationName valida entradas reales y admite vacío cuando es opcional', () => {
  assert.equal(validateOrganizationName('', { required: false }).valid, true);
  assert.equal(validateOrganizationName('', { required: true }).valid, false);
  assert.equal(validateOrganizationName('@@@@').valid, false);
  assert.equal(validateOrganizationName('123456').valid, false);
  assert.equal(validateOrganizationName('Canal 24 Noticias').valid, true);
  assert.equal(validateOrganizationName('Redacción Sur, S.A.').valid, true);
});

test('validateNewPassword exige 12+ caracteres reales con variedad sin espacios en los extremos', () => {
  assert.equal(validateNewPassword('            ').valid, false);
  assert.equal(validateNewPassword('Clave123!   ').valid, false);
  assert.equal(validateNewPassword('aaaaaaaaaaaa').valid, false);
  assert.equal(validateNewPassword('123456789012').valid, false);
  assert.equal(validateNewPassword('sololetraslargas').valid, false);

  assert.equal(validateNewPassword('OmegaPassword!2026').valid, true);
  assert.equal(validateNewPassword('mi-clave-segura-2026').valid, true);
});

test('validateTenantSlug, validateDomain y validateUrlInput bloquean entradas basura o esquemas peligrosos', () => {
  assert.equal(validateTenantSlug('---').valid, false);
  assert.equal(validateTenantSlug('Red Prensa').valid, false);
  assert.equal(validateTenantSlug('redaccion-sur').valid, true);

  assert.equal(validateDomain('https://org.com').valid, false);
  assert.equal(validateDomain('barrabasadas').valid, false);
  assert.equal(validateDomain('redaccion.org').valid, true);

  assert.equal(validateUrlInput('barrabasadas').valid, false);
  assert.equal(validateUrlInput('javascript:alert(1)').valid, false);
  assert.equal(validateUrlInput('999.999.1.1').valid, false);
  assert.equal(validateUrlInput('hxxps://evil[.]example.org/login').valid, true);
  assert.equal(validateUrlInput('185.220.101.44').valid, true);
  assert.equal(validateUrlInput('citizenlab.ca', { allowBareDomain: false }).valid, false);
  assert.equal(validateUrlInput('https://citizenlab.ca/report', { allowBareDomain: false }).valid, true);
});

test('validateAuthRegisterForm y validateAuthLoginForm devuelven errores por campo y sanitizan valores', () => {
  const badReg = validateAuthRegisterForm({
    fullName: 'Juan123',
    email: 'no-es-correo',
    organizationName: '###',
    password: '            ',
  });
  assert.equal(badReg.valid, false);
  assert.ok(badReg.fieldErrors.fullName);
  assert.ok(badReg.fieldErrors.email);
  assert.ok(badReg.fieldErrors.organizationName);
  assert.ok(badReg.fieldErrors.password);

  const badLogin = validateAuthLoginForm(
    { email: 'sin-tld@dominio', password: 'abc', tenantSlug: 'Bad Slug!' },
    { includeTenantSlug: true },
  );
  assert.equal(badLogin.valid, false);
  assert.ok(badLogin.fieldErrors.email);
  assert.ok(badLogin.fieldErrors.tenantSlug);
});

test('bloquea cadenas aleatorias como akjriuqw2iu3i3123.2.q..qw..wqe.r.34 manteniendo entradas legítimas', () => {
  const smash = 'akjriuqw2iu3i3123.2.q..qw..wqe.r.34';
  assert.equal(validateFullName(smash).valid, false);
  assert.equal(validateFullName('xkcdqwrtplm').valid, false);
  assert.equal(validateFullName('Neil Armstrong').valid, true);
  assert.equal(validateOrganizationName(smash, { required: true }).valid, false);
  assert.equal(validateOrganizationName('Redacción Sur, S.A., Bogotá').valid, true);
  assert.equal(validateOrganizationName('Fundación Schwarzschild', { required: true }).valid, true);

  assert.equal(validateEmail(smash).valid, false);
  assert.equal(validateEmail('akjriuqw2iu3i3123.2.q.qw.wqe.r.34@gmail.com').valid, false);
  assert.equal(validateEmail('user@akjriuqw2iu3i3123.2.q.qw.wqe.r.com').valid, false);
  assert.equal(validateEmail('office2000@redaccion.org').valid, true);
  assert.equal(validateEmail('admin@ab12cd34.org').valid, true);

  assert.equal(validateDomain(smash).valid, false);
  assert.equal(validateDomain('akjriuqw2iu3i3123.2.q.qw.wqe.r.com').valid, false);
  assert.equal(validateDomain('akjriuqw2iu3i3123.com').valid, false);
  assert.equal(validateDomain('ab12cd34.org').valid, true);
  assert.equal(validateDomain('163.com').valid, true);

  assert.equal(validateUrlInput(smash).valid, false);
  assert.equal(validateUrlInput('https://akjriuqw2iu3i3123.2.q.qw.wqe.r.com/login').valid, false);

  assert.equal(validateTenantSlug('akjriuqw2iu3i3123', { required: true }).valid, false);
  assert.equal(validateTenantSlug('----', { required: true }).valid, false);
  assert.equal(validateTenantSlug('forensic-gw-ab12cd34').valid, true);
});

test('validateChatMessage, validateIocInput, validateIocList, validateUploadFile y sanitizeSearchInput funcionan correctamente', () => {
  assert.equal(validateChatMessage('akjriuqw2iu3i3123.2.q..qw..wqe.r.34').valid, false);
  assert.equal(validateChatMessage('xkcdqwrtplm').valid, false);
  assert.equal(validateChatMessage('Chrome 120.0.6099.109 en Windows y CVE-2023-41064').valid, true);
  assert.equal(validateChatMessage('¿Qué señales visibles indican posible infección con Pegasus?').valid, true);

  assert.equal(validateIocInput('akjriuqw2iu3i3123.2.q..qw..wqe.r.34').valid, false);
  assert.equal(validateIocInput('CVE-2023-41064').valid, true);
  assert.equal(validateIocInput('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824').valid, true);

  const listBad = validateIocList('akjriuqw2iu3i3123.2.q..qw..wqe.r.34\nbarrabasadas');
  assert.equal(listBad.valid, false);

  const listMixed = validateIocList('akjriuqw2iu3i3123.2.q..qw..wqe.r.34\nevil[.]example.org\n185.220.101.44');
  assert.equal(listMixed.valid, true);
  assert.deepEqual(listMixed.accepted, ['evil.example.org', '185.220.101.44']);
  assert.equal(listMixed.rejected.length, 1);

  assert.equal(validateUploadFile({ name: 'reporte.pdf', size: 1024 }, { extensions: ['.pdf'] }).valid, true);
  assert.equal(validateUploadFile({ name: 'malware.exe', size: 1024 }, { extensions: ['.pdf'] }).valid, false);
  assert.equal(validateUploadFile({ name: 'vacio.pdf', size: 0 }, { extensions: ['.pdf'] }).valid, false);

  assert.equal(sanitizeSearchInput('  hola\u0000   mundo  ', 20), ' hola mundo ');
});
