import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Info, X } from 'lucide-react';

export type ConfirmTone = 'danger' | 'warning' | 'info';

export type ConfirmModalProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** what exactly is about to change, when a sentence is not enough */
  children?: React.ReactNode;
};

const toneStyles: Record<
  ConfirmTone,
  { icon: typeof AlertTriangle; gradient: string; iconColor: string; button: string }
> = {
  danger: {
    icon: AlertTriangle,
    gradient: 'bg-red-50',
    iconColor: 'text-red-600',
    button: 'bg-red-600 hover:bg-red-700 shadow-red-600/20',
  },
  warning: {
    icon: AlertTriangle,
    gradient: 'bg-amber-50',
    iconColor: 'text-amber-600',
    button: 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20',
  },
  info: {
    icon: Info,
    gradient: 'bg-blue-50',
    iconColor: 'text-blue-600',
    button: 'bg-blue-500 hover:bg-blue-600',
  },
};

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading = false,
  error,
  onConfirm,
  onCancel,
  children,
}) => {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onCancel();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, loading, onCancel]);

  if (!open) return null;

  const { icon: Icon, gradient, iconColor, button } = toneStyles[tone];

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-zinc-950/40 p-4 pt-[12vh] backdrop-blur-[2px] sm:p-8 sm:pt-[12vh]"
      onMouseDown={() => !loading && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="relative mb-auto w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-zinc-900/5"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => !loading && onCancel()}
          aria-label={cancelLabel}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-ink"
        >
          <X size={16} />
        </button>

        <div className="px-6 pb-2 pt-6">
          <div className="flex items-start gap-3.5">
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${gradient}`}
            >
              <Icon size={20} className={iconColor} strokeWidth={2.2} />
            </span>
            <div className="min-w-0 pt-0.5">
              <h2 id="confirm-modal-title" className="text-base font-semibold text-ink">
                {title}
              </h2>
              {description && (
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{description}</p>
              )}
              {children}
              {error && (
                <p className="mt-3 whitespace-pre-line rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-line bg-zinc-50/60 px-6 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="ui-btn-secondary"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`flex min-w-[6rem] items-center justify-center rounded-full px-5 py-2.5 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${button}`}
          >
            {loading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ConfirmModal;
