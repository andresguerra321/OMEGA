import { useState } from 'react';
import { createRecoveryKey } from '../lib/api';

export function RecoveryKeyCard() {
  const [password, setPassword] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function generate(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setKey('');
    try {
      const result = await createRecoveryKey(password);
      setKey(result.recoveryKey);
      setPassword('');
    } catch (err) {
      setError(err.message || 'No se pudo generar la clave.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-xl border border-white/10 p-4">
      <h3 className="font-semibold">Recuperación sin correo</h3>
      <p className="text-sm text-[#9FA6B8]">Guarda una clave fuera de OMEGA para recuperar tu cuenta local. Generar otra invalida la anterior.</p>
      <form onSubmit={generate} className="flex flex-wrap gap-2">
        <label className="flex-1 text-sm">Contraseña actual
          <input required type="password" autoComplete="current-password" maxLength={128}
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-white/20 bg-transparent p-2" />
        </label>
        <button disabled={busy} className="self-end rounded-lg bg-[#2F6FED] p-2 text-white disabled:opacity-50">
          {busy ? 'Generando...' : 'Generar clave'}
        </button>
      </form>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {key && <div role="status" className="space-y-2">
        <p className="text-sm">Se muestra una sola vez y permite una recuperación. Guárdala ahora.</p>
        <code className="block break-all select-all rounded-lg border border-white/20 p-3">{key}</code>
      </div>}
    </section>
  );
}
