import { XCircle } from 'lucide-react';
import type { RequestPresentation } from './types';
import { formatDate } from './format';

type Rejection = NonNullable<RequestPresentation['request']['rejection']>;

export default function RequestRejection({ rejection }: { rejection: Rejection }) {
  const by = rejection.by === 'customer' ? 'Rejected by the customer' : 'Rejected by Nexgen';
  const heading = [by, rejection.by_name, formatDate(rejection.at)].filter(Boolean).join(' · ');

  return (
    <section
      aria-label="Rejection"
      data-section="rejection"
      className="flex items-start gap-3 rounded-2xl bg-red-50 px-5 py-4 ring-1 ring-red-200"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-red-100 text-red-600 ring-1 ring-red-200">
        <XCircle size={16} strokeWidth={1.75} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-red-800">{heading}</p>
        <p className="mt-0.5 whitespace-pre-line text-sm text-red-700">{rejection.reason}</p>
      </div>
    </section>
  );
}
