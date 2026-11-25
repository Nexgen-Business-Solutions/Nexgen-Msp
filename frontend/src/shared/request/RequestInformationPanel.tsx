import type { RequestPresentation } from './types';
import { formatStamp, sectionClass, sectionHeadClass } from './format';

const Item = ({ label, value }: { label: string; value: string }) => (
  <div className="px-5 py-3">
    <p className="text-xs text-slate-500">{label}</p>
    <p className="mt-0.5 text-sm font-semibold text-slate-900">{value}</p>
  </div>
);

export default function RequestInformationPanel({ request }: { request: RequestPresentation['request'] }) {
  return (
    <section className={sectionClass} aria-label="Request information" data-section="request-information">
      <div className={sectionHeadClass}>
        <h2 className="text-base font-semibold text-slate-900">Request information</h2>
      </div>
      <div className="divide-y divide-slate-100">
        <Item label="Source" value={request.source || '—'} />
        <Item label="Submitted" value={formatStamp(request.submitted_at) ?? 'Not submitted yet'} />
        <Item label="Customer approval" value={request.customer_approval.label} />
        <Item label="Nexgen status" value={request.nexgen_status_label} />
        {request.modified && (
          <Item
            label="Last modified"
            value={[request.modified.by_name, formatStamp(request.modified.at)].filter(Boolean).join(' · ')}
          />
        )}
      </div>
    </section>
  );
}
