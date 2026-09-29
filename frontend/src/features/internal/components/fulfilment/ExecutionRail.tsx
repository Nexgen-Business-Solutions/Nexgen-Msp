import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ActionWorkGroup, ExecutionPerson } from '@/lib/api/internal';
import { compactBadge, countStatuses, groupKeyOf, type ExecutionSelection } from '../../lib/workDisplay';

type Props = {
  groups: ActionWorkGroup[];
  people: ExecutionPerson[];
  remaining: number;
  pendingByPerson: Record<string, number>;
  selection: ExecutionSelection;
  onSelect: (selection: ExecutionSelection) => void;
};

const PREVIEW = 6;

const Count: React.FC<{ value: number }> = ({ value }) => (
  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{value}</span>
);

const navClass = (on: boolean) =>
  `flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2.5 text-left transition-colors ${
    on ? 'border-blue-200 bg-blue-50' : 'border-transparent hover:bg-slate-50'
  }`;

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{children}</span>
);

const ExecutionRail: React.FC<Props> = ({ groups, people, remaining, pendingByPerson, selection, onSelect }) => {
  const [sectionOpen, setSectionOpen] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <aside
      aria-label="Execution view"
      className="self-start overflow-hidden rounded-xl border border-slate-200 bg-white"
    >
      <div className="border-b border-slate-100 px-3 py-2.5">
        <p className="text-sm font-semibold text-slate-900">Execution view</p>
      </div>

      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-2">
        <SectionTitle>Action groups</SectionTitle>
        <button
          type="button"
          aria-expanded={sectionOpen}
          aria-controls="execution-action-groups"
          aria-label={`${sectionOpen ? 'Collapse' : 'Expand'} action groups`}
          title={`${sectionOpen ? 'Collapse' : 'Expand'} action groups`}
          onClick={() => setSectionOpen((open) => !open)}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
        >
          {sectionOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>

      {sectionOpen && (
        <div id="execution-action-groups" className="space-y-0.5 px-1.5 pb-2" role="list" aria-label="Action groups">
          <div role="listitem">
            <button
              type="button"
              aria-current={selection.kind === 'all' ? 'true' : undefined}
              onClick={() => onSelect({ kind: 'all' })}
              className={navClass(selection.kind === 'all')}
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-slate-900">All remaining work</span>
                <span className="block text-[11px] text-slate-500">Every accepted Work Order</span>
              </span>
              <Count value={remaining} />
            </button>
          </div>

          {groups.map((group) => {
            const key = groupKeyOf(group);
            const counts = countStatuses(group.work);
            const open = Boolean(expanded[key]);
            const on = selection.kind === 'group' && selection.key === key;
            const labels = group.work.map((card) =>
              card.target.sublabel ? `${card.target.label} · ${card.target.sublabel}` : card.target.label
            );

            return (
              <div key={key} role="listitem" data-group-key={key}>
                <div className={`flex items-center gap-1 rounded-lg border ${on ? 'border-blue-200 bg-blue-50' : 'border-transparent'}`}>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={`${open ? 'Collapse' : 'Expand'} ${group.label}`}
                    onClick={() => setExpanded((current) => ({ ...current, [key]: !open }))}
                    className="shrink-0 rounded-md px-1 py-2.5 text-slate-400 hover:text-slate-600"
                  >
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <button
                    type="button"
                    aria-current={on ? 'true' : undefined}
                    onClick={() => onSelect({ kind: 'group', key })}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 py-2.5 pr-2.5 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-slate-900">{group.label}</span>
                      <span className="block text-[11px] text-slate-500">
                        {counts.remaining} remaining · {counts.completed} completed
                      </span>
                    </span>
                    <Count value={group.total} />
                  </button>
                </div>
                {open && (
                  <ul aria-label={`Targets of ${group.label}`} className="mb-1 ml-7 mr-2 border-l border-slate-200 pl-2.5">
                    {labels.slice(0, PREVIEW).map((label, index) => (
                      <li key={`${label}-${index}`} className="truncate py-0.5 text-[11px] text-slate-500">
                        {label}
                      </li>
                    ))}
                    {labels.length > PREVIEW && (
                      <li className="py-0.5 text-[11px] text-slate-400">+ {labels.length - PREVIEW} more</li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-slate-100 px-3 pb-1 pt-2">
        <SectionTitle>People</SectionTitle>
      </div>
      <div className="space-y-0.5 px-1.5 pb-2" role="list" aria-label="People">
        {people.map((person) => {
          const on = selection.kind === 'person' && selection.key === person.subject_key;
          const left = person.remaining + (pendingByPerson[person.subject_key] ?? 0);

          return (
            <div key={person.subject_key} role="listitem">
              <button
                type="button"
                aria-current={on ? 'true' : undefined}
                onClick={() => onSelect({ kind: 'person', key: person.subject_key })}
                className={navClass(on)}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                    <span className="truncate">{person.full_name}</span>
                    {person.is_new && (
                      <span className={`${compactBadge} border-amber-200 bg-amber-50 text-amber-700`}>NEW</span>
                    )}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    {left ? `${left} item${left === 1 ? '' : 's'} remaining` : 'Done'}
                  </span>
                </span>
                {left > 0 && <Count value={left} />}
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
};

export default ExecutionRail;
