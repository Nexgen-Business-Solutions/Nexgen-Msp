import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical, type LucideIcon } from 'lucide-react';

export interface RowAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

const MENU_WIDTH = 208;

const RowActionsMenu: React.FC<{ actions: RowAction[] }> = ({ actions }) => {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const visible = actions.filter((action) => !action.disabled);

  const toggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const estimated = visible.length * 40 + 8;
      const openUp = rect.bottom + estimated > window.innerHeight;
      setCoords({
        top: openUp ? rect.top - estimated - 4 : rect.bottom + 4,
        left: Math.max(8, rect.right - MENU_WIDTH),
      });
    }
    setOpen((current) => !current);
  };

  useEffect(() => {
    if (!open) return;

    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };

    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);

    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  if (visible.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        title="More options"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
      >
        <MoreVertical size={15} />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: coords.top, left: coords.left, width: MENU_WIDTH }}
            className="fixed z-[90] overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
          >
            {visible.map((action, index) => {
              const Icon = action.icon;
              return (
                <React.Fragment key={action.label}>
                  {action.danger && index > 0 && <div className="my-1 h-px bg-slate-100" />}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpen(false);
                      action.onClick();
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      action.danger
                        ? 'text-red-600 hover:bg-red-50'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Icon size={15} className="shrink-0" />
                    {action.label}
                  </button>
                </React.Fragment>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
};

export default RowActionsMenu;
