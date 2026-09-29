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
      className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5"
    >
      <XCircle size={15} className="mt-0.5 shrink-0 text-red-600" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-red-800">{heading}</p>
        <p className="mt-0.5 whitespace-pre-line text-sm text-red-700">{rejection.reason}</p>
      </div>
    </section>
  );
}
