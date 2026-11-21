import { Children, isValidElement, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

function resolveOptionDotClass(value) {
  const v = String(value ?? '').trim().toUpperCase();
  if (v === 'CRITICAL' || v === 'FAIL_PIPELINE' || v === 'OPEN') {
    return 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.55)]';
  }
  if (v === 'HIGH') {
    return 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.45)]';
  }
  if (v === 'MEDIUM' || v === 'COMMENT_PR' || v === 'IN_REVIEW' || v === 'ACCEPTED') {
    return 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.45)]';
  }
  if (v === 'FIXED' || v === 'PASS') {
    return 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.45)]';
  }
  if (v === 'LOW' || v === 'MARK_ONLY' || v === 'FALSE_POSITIVE' || v === 'NONE') {
    return 'bg-slate-400';
  }
  return null;
}

/**
 * Selector desplegable OMEGA con estética dark-glass, navegación completa por teclado
 * y compatibilidad directa con hijos `<option value="...">...</option>` o prop `options`.
 */
export function OmegaSelect({
  id,
  name,
  value,
  onChange,
  disabled = false,
  ariaLabel,
  'aria-label': ariaLabelProp,
  className = '',
  options: optionsProp,
  children,
}) {
  const generatedId = useId();
  const controlId = id || generatedId;
  const listboxId = `${controlId}-listbox`;
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const parsedOptions = useMemo(() => {
    if (Array.isArray(optionsProp) && optionsProp.length > 0) {
      return optionsProp.map((o) => ({
        value: String(o.value ?? ''),
        label: String(o.label ?? o.value ?? ''),
        disabled: Boolean(o.disabled),
      }));
    }
    const out = [];
    Children.toArray(children).forEach((child) => {
      if (!isValidElement(child)) return;
      const rawVal = child.props?.value ?? '';
      const rawChildren = child.props?.children;
      const label = Array.isArray(rawChildren)
        ? rawChildren.map((c) => (c == null ? '' : String(c))).join('')
        : String(rawChildren ?? rawVal);
      out.push({
        value: String(rawVal),
        label,
        disabled: Boolean(child.props?.disabled),
      });
    });
    return out;
  }, [optionsProp, children]);

  const strValue = String(value ?? '');
  const selectedIndex = useMemo(() => {
    const idx = parsedOptions.findIndex((o) => o.value === strValue);
    return idx >= 0 ? idx : 0;
  }, [parsedOptions, strValue]);

  const selectedOption = parsedOptions[selectedIndex] || { value: '', label: 'Seleccionar...' };
  const selectedDot = resolveOptionDotClass(selectedOption.value);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  function commitSelection(opt) {
    if (!opt || opt.disabled || disabled) return;
    setOpen(false);
    if (opt.value !== strValue) {
      onChange?.({
        target: { value: opt.value, name, id: controlId },
        currentTarget: { value: opt.value, name, id: controlId },
      });
    }
  }

  function handleKeyDown(e) {
    if (disabled || parsedOptions.length === 0) return;
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(selectedIndex);
      } else {
        setActiveIndex((prev) => (prev + 1) % parsedOptions.length);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(selectedIndex);
      } else {
        setActiveIndex((prev) => (prev - 1 + parsedOptions.length) % parsedOptions.length);
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(selectedIndex);
      } else {
        const candidate = parsedOptions[activeIndex >= 0 ? activeIndex : selectedIndex];
        commitSelection(candidate);
      }
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        id={controlId}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel || ariaLabelProp}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => {
            const next = !prev;
            if (next) setActiveIndex(selectedIndex);
            return next;
          });
        }}
        onKeyDown={handleKeyDown}
        className={`group w-full inline-flex items-center justify-between gap-2.5 rounded-lg bg-[#141923]/90 border px-3 py-2 text-xs text-left transition-all duration-150 cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed ${
          open
            ? 'border-[#2F6FED] bg-[#171E2C] text-[#F2F2F4] shadow-[0_0_0_1px_rgba(47,111,237,0.35),0_8px_24px_rgba(0,0,0,0.45)]'
            : 'border-white/[0.08] hover:border-white/[0.18] hover:bg-[#171D29] text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
        }`}
      >
        <span className="inline-flex items-center gap-2 min-w-0 truncate">
          {selectedDot && <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${selectedDot}`} />}
          <span className="truncate font-medium">{selectedOption.label}</span>
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-slate-200 transition-transform duration-150 ${
            open ? 'rotate-180 text-[#60A5FA]' : ''
          }`}
          strokeWidth={1.75}
        />
      </button>

      {open && parsedOptions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-labelledby={controlId}
          className="animate-scale-in origin-top absolute left-0 right-0 min-w-[220px] mt-1.5 z-50 max-h-64 overflow-y-auto rounded-xl bg-[#0F131B]/98 border border-white/[0.11] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_20px_48px_rgba(0,0,0,0.82)] space-y-0.5"
        >
          {parsedOptions.map((opt, idx) => {
            const isSelected = opt.value === strValue;
            const isFocused = idx === activeIndex;
            const dotClass = resolveOptionDotClass(opt.value);
            return (
              <li
                key={`${opt.value}-${idx}`}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => commitSelection(opt)}
                className={`flex items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-colors cursor-pointer select-none ${
                  isSelected
                    ? 'bg-[#2F6FED]/18 border border-[#2F6FED]/40 text-white font-medium shadow-[0_0_16px_rgba(47,111,237,0.18)]'
                    : isFocused
                      ? 'bg-white/[0.07] border border-transparent text-slate-100'
                      : 'border border-transparent text-slate-300 hover:bg-white/[0.05] hover:text-white'
                }`}
              >
                <span className="inline-flex items-center gap-2 min-w-0 truncate">
                  {dotClass && <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotClass}`} />}
                  <span className="truncate">{opt.label}</span>
                </span>
                {isSelected && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-[#60A5FA]" strokeWidth={2} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
