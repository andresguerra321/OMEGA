import assert from 'node:assert/strict';
import test from 'node:test';
import { formatGreetingName } from './formatGreetingName.js';

test('preserves real names with accents, compound hyphens, and intentional mixed casing without slicing', () => {
  assert.equal(formatGreetingName({ fullName: 'andrés guerra', email: 'qa.fix.179555@example.org' }), 'Andrés');
  assert.equal(formatGreetingName({ firstName: 'MARÍA', email: 'm@example.org' }), 'María');
  assert.equal(formatGreetingName({ fullName: 'María-Fernanda López' }), 'María');
  assert.equal(formatGreetingName({ fullName: 'Íñigo Montoya' }), 'Íñigo');
  assert.equal(formatGreetingName({ displayName: 'McDonald Smith' }), 'McDonald');
  assert.equal(formatGreetingName({ displayName: 'JeanLuc Picard' }), 'JeanLuc');
  assert.equal(formatGreetingName({ fullName: 'Bartholomew Roberts' }), 'Bartholomew');
  assert.equal(formatGreetingName({ fullName: 'Dev Patel' }), 'Dev');
  assert.equal(formatGreetingName({ firstName: 'Dev' }), 'Dev');
});

test('formats QA and technical test handles cleanly when no real name exists', () => {
  assert.equal(formatGreetingName({ email: 'qa.fix.1795551653173@example.org' }), 'QA Fix');
  assert.equal(formatGreetingName({ email: 'test.automation.998877@omega.dev' }), 'Test');
  assert.equal(formatGreetingName({ username: 'admin_123456' }), 'Admin');
  assert.equal(formatGreetingName({ email: 'dev.ops.991122@example.com' }), 'Dev OPS');
});

test('formats normal personal emails using first alphabetic segment', () => {
  assert.equal(formatGreetingName({ email: 'andres.guerra@gmail.com' }), 'Andres');
  assert.equal(formatGreetingName({ email: 'fitagh@gmail.com' }), 'Fitagh');
  assert.equal(formatGreetingName({ email: 'superlargousuarioejemplo@gmail.com' }), 'Superlargo');
});

test('falls back to Usuario when empty or purely numeric', () => {
  assert.equal(formatGreetingName(null), 'Usuario');
  assert.equal(formatGreetingName({}), 'Usuario');
  assert.equal(formatGreetingName({ email: '1795551653173@example.org' }), 'Usuario');
});
