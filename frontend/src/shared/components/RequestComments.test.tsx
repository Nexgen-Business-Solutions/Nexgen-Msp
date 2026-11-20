import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RequestComment, RequestConversation } from '@/lib/api/portal';
import RequestComments from './RequestComments';

const comment = (over: Partial<RequestComment> = {}): RequestComment => ({
  name: 'CM-1',
  author: 'tech@example.invalid',
  author_name: 'Tess Technician',
  side: 'MSP',
  role: 'MSP Technician',
  body: 'We have started on this.',
  created_at: '2026-11-19 09:30:00',
  ...over,
});

const conversation = (over: Partial<RequestConversation> = {}): RequestConversation => ({
  request: 'SR-0001',
  side: 'Customer',
  may_post: true,
  awaiting_customer_approval: false,
  held: over.comments?.length ?? 0,
  earlier: 0,
  comments: [],
  ...over,
});

type Api = ComponentProps<typeof RequestComments>['api'];

const show = (api: { list: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <RequestComments requestName="SR-0001" api={api as unknown as Api} />
    </QueryClientProvider>
  );
};

const api = (over: Partial<RequestConversation> = {}) => ({
  list: vi.fn().mockResolvedValue(conversation(over)),
  post: vi.fn().mockResolvedValue(comment({ name: 'CM-9' })),
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the conversation on a request', () => {
  it('reads the thread oldest first, naming each author and side', async () => {
    show(
      api({
        comments: [
          comment({
            name: 'CM-1',
            body: 'Before the handover.',
            side: 'Customer',
            author_name: 'Carla Customer',
            role: 'MSP Customer Manager',
          }),
          comment({ name: 'CM-2', body: 'We have it now.', side: 'MSP' }),
        ],
      })
    );

    const thread = await screen.findByRole('log', { name: 'Comments on this request' });
    const rows = within(thread).getAllByRole('listitem');

    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Before the handover.')).toBeTruthy();
    expect(within(rows[0]).getByText('MSP Customer Manager')).toBeTruthy();
    expect(within(rows[1]).getByText('We have it now.')).toBeTruthy();
    expect(within(rows[1]).getByText('MSP Technician')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('says no role at all where none was recorded', async () => {
    show(api({ comments: [comment({ role: null })] }));

    const thread = await screen.findByRole('log', { name: 'Comments on this request' });

    expect(within(thread).getByText('We have started on this.')).toBeTruthy();
    expect(within(thread).queryByText('Nexgen MSP')).toBeNull();
    expect(within(thread).queryByText('MSP Technician')).toBeNull();
  });

  it('says so when nothing has been written yet', async () => {
    show(api());

    expect(await screen.findByText(/No comments yet/)).toBeTruthy();
  });

  it('warns that a preapproval conversation will be read by us later', async () => {
    show(api({ awaiting_customer_approval: true }));

    expect(await screen.findByText(/visible to Nexgen MSP after approval/)).toBeTruthy();
    cleanup();

    show(api());
    await screen.findByText(/No comments yet/);
    expect(screen.queryByText(/visible to Nexgen MSP after approval/)).toBeNull();
  });

  it('posts what was typed, with a key, and clears the box', async () => {
    const calls = api();
    show(calls);
    await screen.findByText(/No comments yet/);

    const box = screen.getByLabelText('New comment');
    fireEvent.change(box, { target: { value: '  Please confirm the date.  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Post comment/ }));

    await waitFor(() => expect(calls.post).toHaveBeenCalledTimes(1));
    expect(calls.post.mock.calls[0][0]).toMatchObject({
      request: 'SR-0001',
      body: 'Please confirm the date.',
    });
    expect(calls.post.mock.calls[0][0].idempotency_key).toBeTruthy();
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(''));
    expect(calls.list).toHaveBeenCalledTimes(2);
  });

  it('keeps the text and the same key when the post fails, and answers again', async () => {
    const calls = api();
    calls.post.mockRejectedValueOnce(new Error('The mail queue is down.'));
    show(calls);
    await screen.findByText(/No comments yet/);

    const box = screen.getByLabelText('New comment');
    fireEvent.change(box, { target: { value: 'Second try please.' } });
    fireEvent.click(screen.getByRole('button', { name: /Post comment/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The mail queue is down.');
    expect((box as HTMLTextAreaElement).value).toBe('Second try please.');

    fireEvent.click(screen.getByRole('button', { name: /Post comment/ }));

    await waitFor(() => expect(calls.post).toHaveBeenCalledTimes(2));
    expect(calls.post.mock.calls[1][0].idempotency_key).toBe(
      calls.post.mock.calls[0][0].idempotency_key
    );
  });

  it('writes nothing while the box is empty', async () => {
    const calls = api();
    show(calls);
    await screen.findByText(/No comments yet/);

    expect(screen.getByRole('button', { name: /Post comment/ })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('New comment'), { target: { value: '   ' } });

    expect(screen.getByRole('button', { name: /Post comment/ })).toBeDisabled();
    expect(calls.post).not.toHaveBeenCalled();
  });

  it('offers no composer where this reader may not post', async () => {
    show(api({ may_post: false, comments: [comment()] }));

    await screen.findByRole('log', { name: 'Comments on this request' });

    expect(screen.queryByLabelText('New comment')).toBeNull();
  });

  it('asks for the page before the oldest it holds, and only when there is one', async () => {
    const calls = api({ comments: [comment({ name: 'CM-9' })], held: 3, earlier: 2 });
    calls.list.mockResolvedValueOnce(conversation({ comments: [comment({ name: 'CM-9' })], held: 3 }));
    calls.list.mockResolvedValueOnce(
      conversation({ comments: [comment({ name: 'CM-1', body: 'Older.' })], held: 3 })
    );
    show(calls);

    fireEvent.click(await screen.findByRole('button', { name: /Show 2 earlier comments/ }));

    await waitFor(() => expect(screen.getByText('Older.')).toBeTruthy());
    expect(calls.list.mock.calls.at(-1)?.slice(0, 3)).toEqual(['SR-0001', 50, 'CM-9']);
    cleanup();

    show(api({ comments: [comment()], held: 1 }));
    await screen.findByRole('log', { name: 'Comments on this request' });
    expect(screen.queryByRole('button', { name: /earlier/ })).toBeNull();
  });
});
