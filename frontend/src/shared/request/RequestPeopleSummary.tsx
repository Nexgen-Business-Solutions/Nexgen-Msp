import { Fragment, useState, type ReactNode } from 'react';
import type { RequestSubjectPresentation } from './types';
import RecordLink from '@/shared/components/RecordLink';
import { badgeClass, linkButtonClass, sectionClass, sectionHeadClass } from './format';

type Props = {
  subjects: RequestSubjectPresentation[];
  total: number;
  renderPersonDetail?: (subject: RequestSubjectPresentation) => ReactNode;
};

const PREVIEW = 3;

const th = 'px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500';
const td = 'px-4 py-2.5 text-sm text-slate-700';

export default function RequestPeopleSummary({ subjects, total, renderPersonDetail }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const shown = showAll ? subjects : subjects.slice(0, PREVIEW);

  return (
    <section className={sectionClass} aria-label="People" data-section="people">
      <div className={sectionHeadClass}>
        <h2 className="text-sm font-semibold text-slate-900">People</h2>
        {!showAll && subjects.length > PREVIEW && (
          <button type="button" onClick={() => setShowAll(true)} className={linkButtonClass}>
            View all {total} people
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50/70">
            <tr>
              <th className={th}>Person</th>
              <th className={th}>Department</th>
              <th className={th}>Type</th>
              <th className={th}>Related work</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((subject) => {
              const detail = renderPersonDetail && open === subject.subject_key ? renderPersonDetail(subject) : null;

              return (
                <Fragment key={subject.subject_key}>
                  <tr>
                    <td className={`${td} font-semibold text-slate-900`}>
                      <span className="inline-flex items-center gap-1.5">
                      {renderPersonDetail ? (
                        <button
                          type="button"
                          aria-expanded={open === subject.subject_key}
                          onClick={() => setOpen(open === subject.subject_key ? null : subject.subject_key)}
                          className="py-0.5 text-left font-semibold text-slate-900 hover:text-blue-700 hover:underline"
                        >
                          {subject.full_name}
                        </button>
                      ) : (
                        subject.full_name
                      )}
                      {subject.type === 'device' ? (
                        <RecordLink name={subject.managed_device} kind="device" />
                      ) : (
                        <RecordLink name={subject.client_user} kind="user" />
                      )}
                      </span>
                    </td>
                    <td className={td}>{subject.department || '—'}</td>
                    <td className={td}>
                      <span className={badgeClass(subject.type === 'new' ? 'amber' : 'slate')}>
                        {subject.type === 'new'
                          ? 'NEW'
                          : subject.type === 'device'
                            ? 'DEVICE'
                            : 'EXISTING'}
                      </span>
                    </td>
                    <td className={td}>
                      {subject.related_work_count} {subject.related_work_count === 1 ? 'action' : 'actions'}
                    </td>
                  </tr>
                  {detail && (
                    <tr>
                      <td colSpan={4} className="p-0">
                        {detail}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!showAll && total > shown.length && (
        <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          {total - shown.length} more {total - shown.length === 1 ? 'person' : 'people'} in this snapshot.
        </p>
      )}
    </section>
  );
}
