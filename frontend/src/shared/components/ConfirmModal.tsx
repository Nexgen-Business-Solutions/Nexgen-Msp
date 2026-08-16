import React, { useEffect } from 'react';
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
  onConfirm: () => void;
  onCancel: () => void;
};

const toneStyles: Record<ConfirmTone, { icon: typeof AlertTriangle; iconBg: string; iconColor: string; button: string }> = {
  danger: {
    icon: AlertTriangle,
    iconBg: 'bg-red-50',
    iconColor: 'text-red-600',
    button: 'bg-red-600 hover:bg-red-700 shadow-red-600/20',
  },
  warning: {
    icon: AlertTriangle,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    button: 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20',
  },
  info: {
    icon: Info,
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    button: 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20',
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
  onConfirm,
  onCancel,
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

  const { icon: Icon, iconBg, iconColor, button } = toneStyles[tone];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
        onClick={() => !loading && onCancel()}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <button
          type="button"
          onClick={() => !loading && onCancel()}
          aria-label={cancelLabel}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <X size={16} />
        </button>

        <div className="px-6 pb-2 pt-6">
          <div className="flex items-start gap-4">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
              <Icon size={22} className={iconColor} />
            </span>
            <div className="min-w-0 pt-1">
              <h2 id="confirm-modal-title" className="text-base font-bold text-slate-900">
                {title}
              </h2>
              {description && (
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{description}</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 pb-6 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`flex min-w-[6rem] items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${button}`}
          >
            {loading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
