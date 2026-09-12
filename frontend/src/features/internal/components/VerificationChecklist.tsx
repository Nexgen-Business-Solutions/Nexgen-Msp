import React, { useState } from 'react';
import { BadgeCheck, Lock } from 'lucide-react';
import type { WorkCard } from '@/lib/api/internal';
import { useVerifyWorkItem } from '../hooks/useRequests';

/**
 * What the record already proves is ticked and locked; the technician only answers for what
 * no record can show. Signing off is what closes the item.
 */
const VerificationChecklist: React.FC<{ card: WorkCard }> = ({ card }) => {
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState(card.customer_visible_note ?? '');
  const [internalNote, setInternalNote] = useState(card.execution_notes ?? '');
  const verify = useVerifyWorkItem();

  const manual = card.checklist.filter((row) => !row.is_done);
  const proven = card.checklist.filter((row) => row.is_done);
  const answered = manual.every((row) => ticked[row.step]);

  return (
    <div className="mt-3">
      <ul className="space-y-1.5">
        {proven.map((row) => (
          <li key={row.name} className="flex items-center gap-2 text-xs text-slate-500">
            <Lock size={12} className="shrink-0 text-emerald-600" />
            {row.step}
          </li>
        ))}
        {manual.map((row) => (
          <li key={row.name}>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(ticked[row.step])}
                onChange={(event) =>
                  setTicked((current) => ({ ...current, [row.step]: event.target.checked }))
                }
                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              {row.step}
            </label>
          </li>
        ))}
      </ul>

      <textarea
        rows={2}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        aria-label="Note for the customer"
        placeholder="A note the customer will see (optional)."
        className="mt-2 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-blue-500"
      />

      <textarea
        rows={2}
        value={internalNote}
        onChange={(event) => setInternalNote(event.target.value)}
        aria-label="Internal note"
        placeholder="An internal note the customer never sees (optional)."
        className="mt-2 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-blue-500"
      />

      <button
        type="button"
        disabled={!answered || verify.isLoading}
        onClick={() =>
          verify.mutate({
            work_order: card.name,
            checklist: Object.fromEntries(
              Object.entries(ticked).map(([step, done]) => [step, done ? 1 : 0])
            ),
            customer_note: note.trim() || undefined,
            notes: internalNote.trim() || undefined,
          })
        }
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50"
      >
        <BadgeCheck size={14} />
        Verify
      </button>

      {verify.error instanceof Error && (
        <p className="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {verify.error.message}
        </p>
      )}
    </div>
  );
};

export default VerificationChecklist;
