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
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-800">Attention</h2>
      <ul className="mt-2 space-y-1.5">
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
