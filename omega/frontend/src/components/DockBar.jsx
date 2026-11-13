import {
  Gauge,
  Laptop,
  Layers,
  Link2,
  MessageSquare,
  Radar,
  Settings,
} from 'lucide-react';

const PRIMARY_ITEMS = [
  { id: 'inicio', label: 'Inicio', ariaLabel: 'Inicio', icon: Gauge },
  { id: 'equipo', label: 'Equipos', ariaLabel: 'Revisar mi equipo', icon: Laptop },
  { id: 'enlace', label: 'Enlaces', ariaLabel: 'Verificar enlace', icon: Link2 },
  { id: 'amenazas', label: 'Amenazas', ariaLabel: 'Amenazas', icon: Layers },
  { id: 'exposicion', label: 'Exposición', ariaLabel: 'Mi exposición', icon: Radar },
];

const UTILITY_ITEMS = [
  { id: 'preguntar', label: 'Asistente', ariaLabel: 'Preguntar', icon: MessageSquare },
  { id: 'ajustes', label: 'Ajustes', ariaLabel: 'Ajustes', icon: Settings },
];

function getLedColor(id, { pcVerdict, usbConnected, apiOnline, isLoadingChat }) {
  if (id === 'inicio') {
    if (!apiOnline) return 'bg-[#FF9F0A]';
    if (pcVerdict === 'alert' || pcVerdict === 'suspicious') return 'bg-[#FF453A]';
    if (pcVerdict === 'warning') return 'bg-[#FF9F0A]';
    return 'bg-[#30D158]';
  }
  if (id === 'equipo') {
    if (pcVerdict === 'alert' || pcVerdict === 'suspicious') return 'bg-[#FF453A]';
    if (usbConnected) return 'bg-[#5E9BFF]';
    return null;
  }
  if (id === 'preguntar' && isLoadingChat) {
    return 'bg-[#5E9BFF] omega-core-pulse';
  }
  return null;
}

export function DockBar({
  activeNav,
  onSelectNav,
  pcVerdict = null,
  usbConnected = false,
  apiOnline = true,
  isLoadingChat = false,
}) {
  const renderDockButton = (item) => {
    const Icon = item.icon;
    const isActive = activeNav === item.id;
    const ledClass = getLedColor(item.id, {
      pcVerdict,
      usbConnected,
      apiOnline,
      isLoadingChat,
    });

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onSelectNav(item.id)}
        aria-label={item.ariaLabel}
        aria-current={isActive ? 'page' : undefined}
        title={item.ariaLabel}
        className={`group relative flex items-center gap-2 rounded-[13px] px-2.5 sm:px-3 py-2 text-[12.5px] font-medium whitespace-nowrap transition-all duration-150 active:translate-y-[1px] cursor-pointer focus-visible:outline-2 focus-visible:outline-[#5E9BFF] focus-visible:outline-offset-2 ${
          isActive
            ? 'bg-gradient-to-b from-[#2F6FED] to-[#235AD0] text-white shadow-[0_6px_18px_rgba(47,111,237,0.38),inset_0_1px_0_rgba(255,255,255,0.28)]'
            : 'text-[#B2B8C4] hover:text-[#F4F6FA] hover:bg-white/[0.07]'
        }`}
      >
        <span className="relative flex items-center justify-center shrink-0">
          <Icon
            className={`h-4 w-4 transition-transform duration-150 ${
              isActive ? 'text-white' : 'text-[#9BA2B0] group-hover:text-[#F4F6FA]'
            }`}
          />
          {ledClass && (
            <span
              aria-hidden="true"
              className={`absolute -top-1 -right-1 h-1.5 w-1.5 rounded-full ring-2 ${
                isActive ? 'ring-[#2963DC]' : 'ring-[#151820]'
              } ${ledClass}`}
            />
          )}
        </span>
        <span className="hidden md:inline tracking-[-0.01em]">{item.label}</span>
      </button>
    );
  };

  return (
    <div className="fixed bottom-3 inset-x-0 z-40 flex justify-center px-3 pointer-events-none">
      <nav
        aria-label="Dock de módulos OMEGA"
        className="omega-dock pointer-events-auto inline-flex max-w-full items-center gap-1 rounded-[18px] px-2 py-1.5 overflow-x-auto no-scrollbar"
      >
        <div className="flex items-center gap-1">
          {PRIMARY_ITEMS.map(renderDockButton)}
        </div>

        <div
          aria-hidden="true"
          className="mx-1 h-6 w-px shrink-0 bg-gradient-to-b from-transparent via-white/[0.14] to-transparent"
        />

        <div className="flex items-center gap-1">
          {UTILITY_ITEMS.map(renderDockButton)}
        </div>
      </nav>
    </div>
  );
}
