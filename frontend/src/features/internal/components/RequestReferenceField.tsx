import React from 'react';
import Select from '@/shared/components/Select';
import type { CustomerRequestRef } from '@/lib/api/internal';

type Props = {
  requests: CustomerRequestRef[];
  value: string;
  onChange: (value: string) => void;
};

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : '');

/** What the customer asked for rarely matches the structure exactly — the action just cites it. */
const RequestReferenceField: React.FC<Props> = ({ requests, value, onChange }) => (
  <div>
    <span className="mb-1.5 block text-xs font-semibold text-slate-700">Related request</span>
    <Select
      className="w-full"
      value={value}
      onChange={onChange}
      placeholder={requests.length ? 'None — acting on our own initiative' : 'No request for this customer'}
      options={[
        { value: '', label: 'None', description: 'Acting on our own initiative' },
        ...requests.map((request) => ({
          value: request.name,
          label: `${request.name} · ${request.request_type}`,
          description: `${request.customer} · ${fmtDate(request.creation)}${
            request.requester ? ` · ${request.requester}` : ''
          } · ${request.status}`,
        })),
      ]}
    />
  </div>
);

export default RequestReferenceField;
