import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

test('Windows audit reads password length from English and Spanish net accounts output', {
  skip: process.platform !== 'win32',
}, () => {
  const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  const literal = source.match(/const WINDOWS_PC_AUDIT_PS = (`[\s\S]*?`);/);
  assert.ok(literal, 'Windows audit script must exist');
  const script = runInNewContext(literal[1]);
  const matchBlock = script.match(/if \(\$line -match '[^']+'\) \{\s*\$pwdMinLen = \[int\]\$Matches\[1\]\s*\}/);
  assert.ok(matchBlock, 'Password length parser must exist');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    $ErrorActionPreference = 'Stop'
    foreach ($line in @('Minimum password length: 14', 'Longitud mínima de contraseña: 12', 'Other setting: 99')) {
      $pwdMinLen = $null
      ${matchBlock[0]}
      if ($null -eq $pwdMinLen) { 'null' } else { $pwdMinLen }
    }
  `], { encoding: 'utf8', windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), ['14', '12', 'null']);
});
