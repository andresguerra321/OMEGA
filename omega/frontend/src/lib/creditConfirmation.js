let confirmHandler = null;

export function registerCreditConfirmation(handler) {
  confirmHandler = handler;
  return () => { if (confirmHandler === handler) confirmHandler = null; };
}

export async function confirmCreditSpend(credits, operation) {
  if (!confirmHandler) throw new Error('Abre OMEGA para confirmar el consumo de créditos.');
  return confirmHandler({ credits, operation });
}
