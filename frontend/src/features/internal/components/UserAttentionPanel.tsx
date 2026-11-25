import React from 'react';
import { Info, TriangleAlert } from 'lucide-react';
import type { AttentionSignal } from '@/lib/api/internal';

/**
 * Anomalies as the backend named them. Nothing on this screen works out for itself what
 * counts as a problem: it is told, with a code, a subject and a sentence.
 */
const UserAttentionPanel: React.FC<{ signals: AttentionSignal[] }> = ({ signals }) => {
  if (!signals.length) return null;

  return (
    <section className="rounded-2xl bg-amber-50/70 p-5 ring-1 ring-amber-200 sm:px-6">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-amber-100 text-amber-700 ring-1 ring-amber-200">
          <TriangleAlert className="size-4" strokeWidth={1.75} />
        </span>
        <h2 className="text-base font-semibold text-amber-900">Attention</h2>
      </div>
      <ul className="mt-3 space-y-2">
        {signals.map((signal) => (
          <li
            key={`${signal.code}-${signal.entity}`}
            className="flex items-start gap-2 text-sm text-amber-900"
          >
            {signal.severity === 'warning' ? (
              <TriangleAlert size={14} className="mt-0.5 shrink-0 text-amber-600" />
            ) : (
              <Info size={14} className="mt-0.5 shrink-0 text-amber-500" />
            )}
            {signal.message}
          </li>
        ))}
      </ul>
    </section>
  );
};

export default UserAttentionPanel;
