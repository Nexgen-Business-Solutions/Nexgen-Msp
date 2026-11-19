import React from 'react';
import { createPortal } from 'react-dom';
import { X, type LucideIcon } from 'lucide-react';

export type ModalTone = 'blue' | 'indigo' | 'emerald' | 'amber' | 'red' | 'slate';

export type ModalProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  tone?: ModalTone;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  widthClass?: string;
  scroll?: boolean;
};

const TONES: Record<ModalTone, { surround: string; icon: string }> = {
  blue: { surround: 'bg-blue-50', icon: 'text-blue-600' },
  indigo: { surround: 'bg-slate-50', icon: 'text-slate-600' },
  emerald: { surround: 'bg-emerald-50', icon: 'text-emerald-600' },
  amber: { surround: 'bg-amber-50', icon: 'text-amber-600' },
  red: { surround: 'bg-red-50', icon: 'text-red-600' },
  slate: { surround: 'bg-slate-100', icon: 'text-slate-600' },
};

const Modal: React.FC<ModalProps> = ({
  open,
  title,
  subtitle,
  icon: Icon,
  tone = 'blue',
  onClose,
  children,
  footer,
  widthClass = 'max-w-2xl',
  scroll = true,
}) => {
  React.useEffect(() => {
    if (!open) return;

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onEscape);

    return () => document.removeEventListener('keydown', onEscape);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/40 p-4 pt-[8vh] backdrop-blur-[2px] sm:p-8 sm:pt-[8vh]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`mb-auto w-full ${widthClass} rounded-2xl bg-white shadow-xl ring-1 ring-zinc-900/5`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="flex min-w-0 items-start gap-3.5">
            {Icon && (
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${TONES[tone].surround}`}
              >
                <Icon size={20} className={TONES[tone].icon} strokeWidth={2.2} />
              </span>
            )}
            <div className="min-w-0 pt-0.5">
              <h2 className="text-base font-semibold text-ink">{title}</h2>
              {subtitle && <p className="mt-0.5 text-[13px] text-muted-ink">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        <div className={`px-6 py-5 ${scroll ? 'max-h-[70vh] overflow-auto' : ''}`}>{children}</div>
        {footer && <div className="rounded-b-2xl border-t border-line bg-zinc-50/60 px-6 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
};

export default Modal;
