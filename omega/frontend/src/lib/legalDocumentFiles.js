export const LEGAL_ACCEPT = '.pdf,.docx,.png,.jpg,.jpeg';
export function validateLegalFile(file) {
  if (!file || file.size === 0) return 'Elige un documento que tenga contenido.';
  if (!/\.(pdf|docx|png|jpe?g)$/i.test(file.name)) return 'Usa PDF, Word (.docx), PNG o JPEG.';
  if (file.size > 64 * 1024 * 1024) return 'El archivo supera los 64 MB. Reduce su tamaño antes de cargarlo.';
  return '';
}
export async function verifyLegalFile(file, expectedHash) {
  const bytes = await file.arrayBuffer();
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('') === expectedHash.toLowerCase();
}
