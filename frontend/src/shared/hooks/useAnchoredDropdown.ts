import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export type DropdownPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: 'top' | 'bottom';
};

const MARGIN = 8;
const MAX_PANEL = 256;

/**
 * Keeps a dropdown anchored to its trigger while rendering it in a portal, so a modal's
 * own `overflow: auto` can never clip it.
 */
export const useAnchoredDropdown = (
  open: boolean,
  close: () => void,
  preferred: 'up' | 'down' = 'down'
) => {
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<DropdownPosition | null>(null);

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - MARGIN;
    const above = rect.top - MARGIN;

    const wantsUp = preferred === 'up';
    const fitsPreferred = wantsUp ? above >= Math.min(MAX_PANEL, above) : below >= 160;
    const placement: 'top' | 'bottom' = wantsUp
      ? above >= 160 || above >= below
        ? 'top'
        : 'bottom'
      : fitsPreferred || below >= above
        ? 'bottom'
        : 'top';

    const space = placement === 'bottom' ? below : above;

    setPosition({
      top: placement === 'bottom' ? rect.bottom + 4 : rect.top - 4,
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(120, Math.min(MAX_PANEL, space)),
      placement,
    });
  }, [preferred]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close();
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    const onReflow = () => measure();

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);

    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, close, measure]);

  const panelStyle = position
    ? {
        position: 'fixed' as const,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
        ...(position.placement === 'bottom'
          ? { top: position.top }
          : { bottom: window.innerHeight - position.top }),
      }
    : undefined;

  return { anchorRef, panelRef, position, panelStyle };
};
