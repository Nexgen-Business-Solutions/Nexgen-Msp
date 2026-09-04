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
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-[1px] sm:p-8"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`my-auto w-full ${widthClass} rounded-2xl border border-slate-200 bg-white shadow-2xl`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3.5">
            {Icon && (
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${TONES[tone].surround}`}
              >
                <Icon size={20} className={TONES[tone].icon} strokeWidth={2.2} />
              </span>
            )}
            <div className="min-w-0 pt-0.5">
              <h2 className="text-base font-semibold text-slate-900">{title}</h2>
              {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>
        <div className={`p-5 ${scroll ? 'max-h-[70vh] overflow-auto' : ''}`}>{children}</div>
        {footer && <div className="border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
};

export default Modal;
