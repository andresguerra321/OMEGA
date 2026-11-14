export const CENTERPIECE_STATE_META = {
  alert: {
    ring: '#EF4444',
    glyph: '#FCA5A5',
    badge: 'Alerta detectada',
  },
  clean: {
    ring: '#22C55E',
    glyph: '#86EFAC',
    badge: 'Verificado limpio',
  },
  standby: {
    ring: '#2F6FED',
    glyph: '#F2F2F4',
    badge: 'En espera',
  },
};

const SURFACE_LABELS = {
  windows: 'Auditoría Windows',
  usb: 'Inspección USB',
  link: 'Verificador de enlaces',
  omega: 'Motor OMEGA',
};

export function formatCenterpieceStatus(
  surfaceId = 'windows',
  healthy = false,
  alert = false,
) {
  const mode = alert ? 'alert' : healthy ? 'clean' : 'standby';
  const surfaceLabel = SURFACE_LABELS[surfaceId] || 'Centro de protección';
  return {
    mode,
    palette: CENTERPIECE_STATE_META[mode],
    statusText: `${surfaceLabel}: ${CENTERPIECE_STATE_META[mode].badge}`,
  };
}
