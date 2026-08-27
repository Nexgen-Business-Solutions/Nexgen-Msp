import React, { useState } from 'react';
import { MessageSquare, Plus } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { RemarkEntry } from '@/lib/api/internal';

const fmt = (value?: string | null) => (value ? String(value).slice(0, 16).replace('T', ' ') : '');

type Props = {
  entries?: RemarkEntry[];
  empty?: string;
  /** The record the note is written on; omit to render the history read-only. */
  target?: { doctype: string; name: string };
  /** What to refresh once a note has landed. */
  invalidate?: readonly unknown[];
};

/** Notes as a history: who wrote what, and when. Newest last, as they were written. */
const RemarkLog: React.FC<Props> = ({ entries, empty = 'Nothing noted yet.', target, invalidate }) => {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);

  const add = useMutation({
    mutationFn: (text: string) =>
      internal.addRemark({ doctype: target!.doctype, name: target!.name, note: text }),
    onSuccess: () => {
      setNote('');
      setOpen(false);
      if (invalidate) queryClient.invalidateQueries({ queryKey: invalidate });
    },
  });

  return (
    <div>
      {!entries || entries.length === 0 ? (
        <p className="text-sm text-slate-400">{empty}</p>
      ) : (
        <ul className="space-y-2.5">
          {entries.map((entry) => (
            <li key={entry.idx} className="flex items-start gap-2.5">
              <MessageSquare size={14} className="mt-1 shrink-0 text-slate-300" />
              <div className="min-w-0">
                <p className="text-sm text-slate-700">{entry.note}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {fmt(entry.noted_on)}
                  {entry.noted_by ? ` · ${entry.noted_by}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {target && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700"
        >
          <Plus size={14} />
          Add a note
        </button>
      )}

      {target && open && (
        <div className="mt-3 max-w-xl">
          <textarea
            autoFocus
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Screen replaced under warranty."
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
          {add.error instanceof Error && (
            <p className="mt-1 text-xs text-red-600">{add.error.message}</p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={!note.trim() || add.isLoading}
              onClick={() => add.mutate(note.trim())}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setNote('');
                add.reset();
              }}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RemarkLog;
