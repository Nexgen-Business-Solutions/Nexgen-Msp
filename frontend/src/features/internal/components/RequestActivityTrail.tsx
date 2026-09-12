import React, { useState } from 'react';
import { ChevronDown, History } from 'lucide-react';
import type { ExecutionPlan } from '@/lib/api/internal';

const stamp = (value: string) => String(value).slice(0, 16).replace('T', ' ');

// comments arrive as stored HTML; the trail only ever shows the words
const words = (html: string) => html.replace(/<[^>]*>/g, '').trim();

/** What happened on this request and when, told by the work itself. */
const RequestActivityTrail: React.FC<{ activity?: ExecutionPlan['activity'] }> = ({ activity }) => {
  const [open, setOpen] = useState(false);

  if (!activity?.length) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="inline-flex items-center gap-2 text-sm font-bold text-slate-900">
          <History size={15} className="text-slate-400" />
          Activity
          <span className="font-normal text-slate-400">({activity.length})</span>
        </span>
        <ChevronDown
          size={16}
          className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ol className="space-y-1.5 border-t border-slate-100 px-4 py-3">
          {activity.map((row, index) => (
            <li key={index} className="flex flex-wrap gap-x-2 text-xs text-slate-600">
              <span className="font-mono text-slate-400">{stamp(row.at)}</span>
              <span className="font-semibold text-slate-700">{row.who}</span>
              {row.about && <span className="text-slate-500">{row.about}</span>}
              <span>{words(row.said)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

export default RequestActivityTrail;
