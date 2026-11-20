import React, { useRef, useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { RequestComment, RequestConversation } from '@/lib/api/portal';

type Props = {
  requestName: string;
  api: {
    list: (
      request: string,
      limit?: number,
      before?: string,
      signal?: AbortSignal
    ) => Promise<RequestConversation>;
    post: (payload: {
      request: string;
      body: string;
      idempotency_key: string;
    }) => Promise<RequestComment>;
  };
};

const MAX = 4000;
const PAGE = 50;

/** A fresh key per intention to post, so a retry of the same one says it once. */
const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

const when = (value: string) => {
  const moment = new Date(value.replace(' ', 'T'));

  return Number.isNaN(moment.getTime()) ? value : moment.toLocaleString();
};

const Message: React.FC<{ comment: RequestComment }> = ({ comment }) => {
  const ours = comment.side === 'MSP';

  return (
    <li className="flex items-start gap-3 border-b border-slate-100 py-4 last:border-b-0">
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
          ours ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
        }`}
        aria-hidden="true"
      >
        {initials(comment.author_name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-2">
          <strong className="text-xs font-semibold text-slate-900">{comment.author_name}</strong>
          {comment.role && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                ours ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {comment.role}
            </span>
          )}
        </p>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700">
          {comment.body}
        </p>
        <time className="mt-1.5 block text-[10px] text-slate-400">{when(comment.created_at)}</time>
      </div>
    </li>
  );
};

/** The pages read, oldest message first and each message once. */
const sequence = (pages: RequestConversation[]) => {
  const said = new Set<string>();

  return [...pages]
    .reverse()
    .flatMap((page) => page.comments)
    .filter((comment) => {
      if (said.has(comment.name)) return false;

      said.add(comment.name);

      return true;
    });
};

/** The conversation on one request, the same component wherever the request is read. */
const RequestComments: React.FC<Props> = ({ requestName, api }) => {
  const client = useQueryClient();
  const key = ['request-comments', requestName];
  // every page read so far, held as one sequence: a refresh re-reads them all in order,
  // from the latest backwards, so a message written meanwhile cannot fall between two of
  // them and become unreachable
  const thread = useInfiniteQuery<RequestConversation, Error>(
    key,
    ({ pageParam, signal }) => api.list(requestName, PAGE, pageParam, signal),
    {
      enabled: Boolean(requestName),
      getNextPageParam: (page) =>
        page.earlier > 0 && page.comments.length ? page.comments[0].name : undefined,
    }
  );
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const intention = useRef(newKey());

  const post = useMutation(
    (body: string) =>
      api.post({ request: requestName, body, idempotency_key: intention.current }),
    {
      onSuccess: () => {
        intention.current = newKey();
        setDraft('');
        setFailed(null);
        client.invalidateQueries(key);
      },
      onError: (error) => setFailed(error instanceof Error ? error.message : 'The comment was not posted.'),
    }
  );

  const pages = thread.data?.pages ?? [];
  const head = pages[0];
  const comments = sequence(pages);
  const earlier = pages.length ? pages[pages.length - 1].earlier : 0;
  const fetching = thread.isFetchingNextPage;
  const sending = post.isLoading;
  const tooLong = draft.length > MAX;

  return (
    <section
      className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white"
      aria-label="Request comments"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <p className="flex items-center gap-2">
            <MessageSquare size={17} className="text-blue-600" />
            <span className="text-[15px] font-semibold text-slate-900">Comments</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
              {head?.held ?? comments.length}
            </span>
          </p>
          {head?.awaiting_customer_approval && (
            <p className="ml-7 mt-1 text-[11px] text-slate-500">
              Visible to authorized customer participants now. This conversation will be visible to
              Nexgen MSP after approval and submission.
            </p>
          )}
        </div>
        <span className="text-[11px] text-slate-500">Chronological thread</span>
      </div>

      <div className="px-5">
        {thread.isLoading ? (
          <p className="py-6 text-center text-xs text-slate-500">Loading the conversation…</p>
        ) : thread.error ? (
          <p role="alert" className="py-6 text-center text-xs font-semibold text-red-700">
            {thread.error instanceof Error ? thread.error.message : 'The conversation could not be read.'}
          </p>
        ) : comments.length ? (
          <>
            {Boolean(earlier) && thread.hasNextPage && (
              <button
                type="button"
                disabled={fetching}
                onClick={() => thread.fetchNextPage()}
                className="mt-3 w-full rounded-lg border border-slate-200 py-2 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:text-slate-400"
              >
                {fetching ? 'Loading…' : `Show ${earlier} earlier ${earlier === 1 ? 'comment' : 'comments'}`}
              </button>
            )}
            <ul className="list-none" role="log" aria-label="Comments on this request">
            {comments.map((comment) => (
              <Message key={comment.name} comment={comment} />
            ))}
            </ul>
          </>
        ) : (
          <p className="py-6 text-center text-xs text-slate-500">
            No comments yet. Ask a question or add information about this request.
          </p>
        )}
      </div>

      {head?.may_post && (
        <div className="border-t border-slate-200 bg-slate-50/60 px-5 py-4">
          <p className="mb-1.5 text-xs font-semibold text-slate-900">Write a comment</p>
          <textarea
            rows={4}
            value={draft}
            maxLength={MAX}
            disabled={sending}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="New comment"
            placeholder="Ask a question or add information about this request…"
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs leading-relaxed outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500">
              Visible to authorized participants. Not an internal note.
            </p>
            <button
              type="button"
              disabled={sending || !draft.trim() || tooLong}
              onClick={() => post.mutate(draft.trim())}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:bg-blue-300"
            >
              <Send size={14} />
              {sending ? 'Posting…' : 'Post comment'}
            </button>
          </div>
          {failed && (
            <p role="alert" className="mt-2 text-[11px] font-semibold text-red-700">
              {failed}
            </p>
          )}
        </div>
      )}
    </section>
  );
};

export default RequestComments;
