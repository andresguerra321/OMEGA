import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateLegalFile, verifyLegalFile } from './legalDocumentFiles.js';

test('document validation rejects empty, unsupported and oversized files', () => {
  assert.match(validateLegalFile({ name: 'synthetic.pdf', size: 0 }), /contenido/);
  assert.match(validateLegalFile({ name: 'synthetic.exe', size: 20 }), /PDF/);
  assert.match(validateLegalFile({ name: 'synthetic.pdf', size: 65 * 1024 * 1024 }), /64 MB/);
  for (const extension of ['PDF', 'docx', 'png', 'jpg', 'jpeg']) assert.equal(validateLegalFile({ name: `synthetic.${extension}`, size: 20 }), '');
});
test('local hash verification checks original bytes without uploading', async () => {
  const file = new Blob(['synthetic bytes']);
  const hash = createHash('sha256').update('synthetic bytes').digest('hex');
  assert.equal(await verifyLegalFile(file, hash), true);
  assert.equal(await verifyLegalFile(file, '0'.repeat(64)), false);
});
