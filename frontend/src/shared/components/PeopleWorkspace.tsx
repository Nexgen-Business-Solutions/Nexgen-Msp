import React, { useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';

export type WorkspacePerson = {
  key: string;
  name: string;
  /** what is left for this person, or that they are done */
  hint: string;
  done: boolean;
};

type Props = {
  people: WorkspacePerson[];
  /** everything about the chosen person */
  children: (key: string) => ReactNode;
};

const card = 'overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm';

/**
 * One person at a time: the people on the left, the chosen one on the right, and the next one a
 * click away once this one is done. The same layout as the request's Changes step.
 */
const PeopleWorkspace: React.FC<Props> = ({ people, children }) => {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const index = Math.max(0, people.findIndex((row) => row.key === activeKey));
  const person = people[index];

  if (!person) return null;

  const previous = index > 0 ? people[index - 1] : undefined;
  const next = people[index + 1];

  const go = (key: string) => {
    setActiveKey(key);
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  };

  const detail = (
    <div className="min-w-0">
      {children(person.key)}

      {people.length > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-3 py-2">
          <button
            type="button"
            onClick={() => previous && go(previous.key)}
            disabled={!previous}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ArrowLeft size={14} className="shrink-0" />
            Previous
          </button>

          <span className="shrink-0 text-xs font-medium text-slate-500">
            Person {index + 1} of {people.length}
          </span>

          <button
            type="button"
            onClick={() => next && go(next.key)}
            disabled={!next}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
          >
            Next
            <ArrowRight size={14} className="shrink-0" />
          </button>
        </div>
      )}
    </div>
  );

  if (people.length === 1) return <div className={card}>{detail}</div>;

  return (
    <div className={`${card} lg:grid lg:grid-cols-[15rem_1fr]`}>
      <nav
        aria-label="People"
        className="space-y-1.5 border-b border-slate-100 bg-slate-50/60 p-2 lg:border-b-0 lg:border-r"
      >
        {people.map((row, position) => {
          const active = row.key === person.key;

          return (
            <button
              key={row.key}
              type="button"
              onClick={() => go(row.key)}
              aria-current={active ? 'true' : undefined}
              className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                active ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  row.done
                    ? 'bg-emerald-100 text-emerald-700'
                    : active
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                {row.done ? <Check size={12} /> : position + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-900">{row.name}</span>
                <span className={`block text-xs ${row.done ? 'text-emerald-700' : 'text-slate-500'}`}>{row.hint}</span>
              </span>
            </button>
          );
        })}
      </nav>

      {detail}
    </div>
  );
};

export default PeopleWorkspace;
