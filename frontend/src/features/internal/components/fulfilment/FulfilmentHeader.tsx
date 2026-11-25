import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { badgeClass, formatDate, formatStamp, type BadgeTone } from '@/shared/request/format';

type Props = {
  name: string;
  customer: string;
  source: string | null;
  submittedAt: string | null;
  badges: { tone: BadgeTone; label: string }[];
  note: { text: string; by: string | null; at: string | null } | null;
  actions?: React.ReactNode;
  stepper?: React.ReactNode;
  onBack: () => void;
};

const FulfilmentHeader: React.FC<Props> = ({
  name,
  customer,
  source,
  submittedAt,
  badges,
  note,
  actions,
  stepper,
  onBack,
}) => {
  const submitted = formatDate(submittedAt);
  const meta = [customer, source, submitted ? `Submitted ${submitted}` : null].filter(Boolean).join(' · ');
  const noteBy = note ? [note.by, formatStamp(note.at)].filter(Boolean).join(' · ') : '';

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={14} />
        Back to requests
      </button>

      <section aria-label="Request" className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
        <div className="flex flex-col items-start justify-between gap-3 px-5 pb-4 pt-5 sm:px-6 md:flex-row">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{name}</h1>
            <p className="mt-1 text-sm text-slate-500">{meta}</p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {badges.map((badge) => (
                <span key={badge.label} className={badgeClass(badge.tone)}>
                  {badge.label}
                </span>
              ))}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>

        {note && (
          <div className="mx-5 mb-4 rounded-xl bg-blue-50/50 px-4 py-3 ring-1 ring-blue-100 sm:mx-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-bold text-blue-900">Request note</p>
              {noteBy && <p className="text-[11px] text-slate-500">{noteBy}</p>}
            </div>
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-700">{note.text}</p>
          </div>
        )}

        {stepper && <div className="border-t border-slate-100 px-5 py-4 sm:px-6">{stepper}</div>}
      </section>
    </div>
  );
};

export default FulfilmentHeader;
