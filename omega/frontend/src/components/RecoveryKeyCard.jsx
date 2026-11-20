import { useState } from 'react';
import { createRecoveryKey } from '../lib/api';

export function RecoveryKeyCard({ embedded = false }) {
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
    <section className={embedded ? 'space-y-3' : 'space-y-3 rounded-xl border border-white/10 p-4'}>
      {!embedded && (
        <>
          <h3 className="font-semibold">Recuperación sin correo</h3>
          <p className="text-sm text-[#9FA6B8]">Guarda una clave fuera de OMEGA para recuperar tu cuenta local. Generar otra invalida la anterior.</p>
        </>
      )}
      <form onSubmit={generate} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        <input
          required
          type="password"
          autoComplete="current-password"
          maxLength={128}
          aria-label="Contraseña actual"
          placeholder="Contraseña actual"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-9.5 flex-1 min-w-0 rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 text-[13px] text-[#F2F2F4] placeholder-[#8E95A5] focus:outline-none focus:border-[#2F6FED]"
        />
        <button
          disabled={busy}
          className="h-9.5 shrink-0 rounded-lg bg-[#2F6FED] hover:brightness-110 px-4 text-[12.5px] font-medium text-white disabled:opacity-50 cursor-pointer transition-all"
        >
          {busy ? 'Generando...' : 'Generar clave'}
        </button>
      </form>
      {error && <p role="alert" className="text-xs text-[#FF6961]">{error}</p>}
      {key && <div role="status" className="space-y-2 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
        <p className="text-xs text-[#8E95A5]">Se muestra una sola vez y permite una recuperación. Guárdala ahora.</p>
        <code className="block break-all select-all rounded-md border border-white/[0.08] bg-[#0A0A0C] p-2.5 font-tech text-xs text-[#F2F2F4]">{key}</code>
      </div>}
    </section>
  );
}
