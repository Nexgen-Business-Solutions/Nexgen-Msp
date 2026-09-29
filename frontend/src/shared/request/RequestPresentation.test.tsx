import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import RequestPresentation from './RequestPresentation';
import RequestApprovalBar from './RequestApprovalBar';
import type { RequestPresentation as Presentation, RequestPresentationMode } from './types';
import { completedFixture, presentationFixture } from './presentation.fixture';

afterEach(cleanup);

const MODES: RequestPresentationMode[] = [
  'creation_review',
  'customer_approval',
  'internal_review',
  'internal_detail',
  'completed_detail',
];

const controlsFor = (mode: RequestPresentationMode) => {
  if (mode === 'creation_review') {
    return {
      headerActions: (
        <>
          <button type="button">Edit actions</button>
          <button type="button">Submit request</button>
        </>
      ),
    };
  }
  if (mode === 'customer_approval') {
    return { approvalBar: <RequestApprovalBar onApprove={vi.fn()} onReject={vi.fn()} /> };
  }
  if (mode === 'internal_review') {
    return {
      renderGroupControls: () => (
        <>
          <button type="button">Accept all</button>
          <button type="button">Reject all</button>
        </>
      ),
      renderTargetControls: () => (
        <>
          <button type="button">Accept</button>
          <button type="button">Reject</button>
        </>
      ),
    };
  }
  if (mode === 'completed_detail') return { onViewExecutionRecap: vi.fn() };
  return {};
};

const fixtureFor = (mode: RequestPresentationMode): Presentation =>
  mode === 'completed_detail'
    ? { ...presentationFixture(), fulfilment_outcome: completedFixture().fulfilment_outcome }
    : presentationFixture();

const renderMode = (
  mode: RequestPresentationMode,
  presentation: Presentation = fixtureFor(mode),
  extra: Record<string, unknown> = {}
) =>
  render(
    <MemoryRouter>
      <RequestPresentation presentation={presentation} mode={mode} {...controlsFor(mode)} {...extra} />
    </MemoryRouter>
  );

const section = (name: string) => document.querySelector(`[data-section="${name}"]`) as HTMLElement | null;

const groupSummaries = () =>
  [...document.querySelectorAll('[data-group]')].map((group) => {
    const cells = [...(group.firstElementChild as HTMLElement).children].slice(0, 3);
    return cells.map((cell) => cell.textContent).join(' | ');
  });

const coreText = () => ({
  people: section('people')?.textContent,
  groups: groupSummaries(),
  entities: section('requested-entities')?.textContent,
});

const wrap = (node: ReactNode) => <MemoryRouter>{node}</MemoryRouter>;

describe('one request, the same core in every mode', () => {
  it('shows identical People, Action group and Requested entity text whatever the mode', () => {
    const cores = MODES.map((mode) => {
      renderMode(mode);
      const core = coreText();
      cleanup();
      return core;
    });

    for (const core of cores) expect(core).toEqual(cores[0]);

    expect(cores[0].groups).toEqual([
      'Add Microsoft 365Purchasing · Personal service | 8 targets from 9 people1 left unchanged | 1 NEW PERSON',
      'End NextcloudPurchasing · Personal service | 6 targets from 9 people3 left unchanged | CURRENT ASSIGNMENTS',
      'Change holderACI-LT-023 · Device operation | 1 DeviceExisting Device | Franck Mbassi → Marie DupontNEW',
      'Add SophosDevice service | 1 requested Device | ',
    ]);
    expect(cores[0].entities).toBe(
      'Requested entitiesOnly unresolved/new records' +
        'Marie DupontRequested Client User · PurchasingNEEDS REVIEW' +
        'Used by 4 requested actions · destination holder for ACI-LT-023' +
        'New laptopRequested Device · intended for Marie DupontUNRESOLVED' +
        'Requested work: Add Sophos · holder: Marie Dupont [NEW]'
    );
    expect(cores[0].people).toBe(
      'PeopleView all 9 people' +
        'PersonDepartmentTypeRelated work' +
        'Alice NdomPurchasingEXISTING2 actions' +
        'Brice MvondoPurchasingEXISTING3 actions' +
        'Marie DupontPurchasingNEW4 actions' +
        '6 more people in this snapshot.'
    );
  });

  it('varies only the controls and the outcome block', () => {
    renderMode('creation_review');
    expect(screen.getByRole('heading', { name: 'Review request' })).toBeInTheDocument();
    expect(screen.getByText('Confirm the exact snapshot and requested actions before submission.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeInTheDocument();
    expect(screen.queryByText('Internal approval required')).not.toBeInTheDocument();
    expect(screen.queryByText('Fulfilment outcome')).not.toBeInTheDocument();
    cleanup();

    renderMode('customer_approval');
    expect(screen.getByRole('heading', { name: 'Request SR-2026-00544' })).toBeInTheDocument();
    expect(
      screen.getByText('Review the exact request submitted by Devteam Cam before it is sent to Nexgen.')
    ).toBeInTheDocument();
    expect(screen.getByText('Internal approval required')).toBeInTheDocument();
    expect(
      screen.getByText('Approval records intent only. No MSP lifecycle operation is executed here.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve and send to Nexgen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept all' })).not.toBeInTheDocument();
    expect(screen.queryByText('Fulfilment outcome')).not.toBeInTheDocument();
    cleanup();

    renderMode('internal_review');
    expect(screen.getByText('Review the customer-approved request before execution.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Accept all' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Reject all' })).toHaveLength(2);
    expect(screen.queryByText('Internal approval required')).not.toBeInTheDocument();
    cleanup();

    renderMode('internal_detail');
    expect(screen.getByRole('heading', { name: 'Request SR-2026-00544' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept|reject|approve|submit/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Fulfilment outcome')).not.toBeInTheDocument();
    cleanup();

    renderMode('completed_detail');
    expect(screen.getByText('Completed request · final intent and fulfilment outcome.')).toBeInTheDocument();
    expect(screen.getByText('Fulfilment outcome')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View execution recap' })).toBeInTheDocument();
  });

  it('never names an assignee, in any mode', () => {
    for (const mode of MODES) {
      renderMode(mode);
      const text = document.body.textContent ?? '';
      expect(text, mode).not.toMatch(/Assigned|Assignee|Owner|Technician/);
      cleanup();
    }
  });

  it('keeps the metadata strip, the dated business note and the four summary cells', () => {
    renderMode('internal_detail');

    for (const [label, value] of [
      ['Customer', 'Assurances Cameroun International'],
      ['Requested by', 'Devteam Cam'],
      ['Requested date', '29 Sep 2026'],
      ['Priority', 'Medium'],
      ['People', '9'],
      ['Action groups', '4'],
    ]) {
      const cell = screen.getByText(label, { selector: 'p' }).parentElement as HTMLElement;
      expect(within(cell).getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByText('Business note')).toBeInTheDocument();
    expect(screen.getByText('Devteam Cam · 27 Sep 2026 · 08:42')).toBeInTheDocument();

    const summary = screen.getByRole('region', { name: 'Request summary' });
    expect(summary.textContent).toBe('9People in snapshot4Requested actions16Concrete targets2New entities');

    expect(screen.getByText('UNDER REVIEW')).toBeInTheDocument();
    expect(screen.getByText('2 NEW ENTITIES')).toBeInTheDocument();

    const info = section('request-information') as HTMLElement;
    expect(info.textContent).toBe(
      'Request informationSourcePortalSubmitted27 Sep 2026 · 08:42' +
        'Customer approvalApproved · Paul Approver · 27 Sep 2026Nexgen statusUnder Review'
    );
  });
});

describe('what the server says, rendered as it is said', () => {
  it('takes the header badges, the approval label and the Nexgen status from the payload', () => {
    const presentation = presentationFixture();
    presentation.request.status = 'Draft';
    presentation.request.badges = [
      { tone: 'red', label: 'FROM THE SERVER' },
      { tone: 'emerald', label: 'SECOND BADGE' },
    ];
    presentation.request.customer_approval = {
      state: 'pending',
      by_name: null,
      at: null,
      label: 'Awaiting approval',
    };
    presentation.request.nexgen_status_label = 'Not submitted yet';
    renderMode('internal_detail', presentation);

    const badges = [...document.querySelectorAll('h1 ~ div > span')].map((badge) => badge.textContent);
    expect(badges).toEqual(['FROM THE SERVER', 'SECOND BADGE']);
    expect(screen.getByText('FROM THE SERVER').className).toContain('text-red-700');
    expect(screen.queryByText('DRAFT')).not.toBeInTheDocument();
    expect(screen.queryByText('2 NEW ENTITIES')).not.toBeInTheDocument();

    const info = section('request-information') as HTMLElement;
    expect(within(info).getByText('Awaiting approval')).toBeInTheDocument();
    expect(within(info).getByText('Not submitted yet')).toBeInTheDocument();
  });

  it('renders the rejection itself, in a compact row under the header', () => {
    const presentation = presentationFixture();
    presentation.request.rejection = {
      reason: 'Out of contract',
      by: 'nexgen',
      by_name: 'Nadia Tech',
      at: '2026-09-27 12:00:00',
    };
    renderMode('internal_detail', presentation);

    const row = section('rejection') as HTMLElement;
    expect(row.textContent).toBe('Rejected by Nexgen · Nadia Tech · 27 Sep 2026Out of contract');
    const header = screen.getByRole('heading', { name: 'Request SR-2026-00544' }).closest('section') as HTMLElement;
    expect(header.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();

    presentation.request.rejection = { reason: 'Not this quarter', by: 'customer', by_name: null, at: null };
    renderMode('portal_detail', presentation);
    expect((section('rejection') as HTMLElement).textContent).toBe('Rejected by the customerNot this quarter');
    cleanup();

    renderMode('internal_detail');
    expect(section('rejection')).toBeNull();
  });
});

describe('what is only shown when there is something to show', () => {
  it('says "No business note." in a compact row when there is none', () => {
    const presentation = presentationFixture();
    presentation.request.details = null;
    renderMode('internal_detail', presentation);

    expect(screen.getByText('No business note.')).toBeInTheDocument();
  });

  it('drops the requested entities and attention panels when they are empty', () => {
    const presentation = { ...presentationFixture(), requested_entities: [], attention: [] };
    renderMode('internal_detail', presentation);

    expect(screen.queryByText('Requested entities')).not.toBeInTheDocument();
    expect(screen.queryByText('Attention')).not.toBeInTheDocument();
    expect(screen.getByText('Request information')).toBeInTheDocument();
  });

  it('names who last modified the request and when, in every mode, only when it was modified', () => {
    for (const mode of [...MODES, 'portal_detail' as const]) {
      const presentation = fixtureFor(mode);
      presentation.request.modified = { by_name: 'Devteam Cam', at: '2026-09-28 09:15:00' };
      renderMode(mode, presentation);

      const info = section('request-information') as HTMLElement;
      const row = within(info).getByText('Last modified').parentElement as HTMLElement;
      expect(row.textContent, mode).toBe('Last modifiedDevteam Cam · 28 Sep 2026 · 09:15');
      cleanup();

      renderMode(mode);
      expect(within(section('request-information') as HTMLElement).queryByText('Last modified'), mode).toBeNull();
      cleanup();
    }
  });

  it('lists the attention items when there are some', () => {
    const presentation = presentationFixture();
    presentation.attention = [
      'Brice Mvondo no longer holds Nextcloud.',
      'The customer changed the requested date after submission.',
    ];
    renderMode('internal_detail', presentation);
    const attention = section('attention') as HTMLElement;

    expect(within(attention).getByText('Brice Mvondo no longer holds Nextcloud.')).toBeInTheDocument();
    expect(
      within(attention).getByText('The customer changed the requested date after submission.')
    ).toBeInTheDocument();
  });

  it('hides the attention panel for the owner example, where every fact already has its badge', () => {
    renderMode('internal_review');

    expect(section('attention')).toBeNull();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/Destination is not yet a Client User|Device not yet resolved|Requires (Device|Client User) resolution/);
  });

  it('renders the fulfilment outcome only in completed detail, even when the payload carries one', () => {
    const outcome = completedFixture().fulfilment_outcome;
    for (const mode of MODES.filter((row) => row !== 'completed_detail')) {
      renderMode(mode, { ...presentationFixture(), fulfilment_outcome: outcome });
      expect(section('fulfilment-outcome'), mode).toBeNull();
      cleanup();
    }
    renderMode('completed_detail', { ...presentationFixture(), fulfilment_outcome: outcome });
    expect(section('fulfilment-outcome')).not.toBeNull();
  });
});

describe('people', () => {
  it('previews three people and expands to the whole snapshot', () => {
    renderMode('internal_detail');
    const people = section('people') as HTMLElement;

    expect(within(people).getAllByRole('row')).toHaveLength(4);
    expect(within(people).queryByText('Irène Biloa')).not.toBeInTheDocument();

    fireEvent.click(within(people).getByRole('button', { name: 'View all 9 people' }));

    expect(within(people).getAllByRole('row')).toHaveLength(10);
    expect(within(people).getByText('Irène Biloa')).toBeInTheDocument();
  });
});

describe('requested actions', () => {
  it('reveals the target table on "View details"', () => {
    renderMode('internal_detail');
    const group = document.querySelector('[data-group="grp-sophos"]') as HTMLElement;

    expect(within(group).queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: 'View details' }));

    const table = within(group).getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Person',
      'Target',
      'Requested operation',
      'State at request time',
    ]);
    const row = within(table).getAllByRole('row')[1];
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'Marie DupontNEW',
      'New laptopUNRESOLVED',
      'Add Sophos',
      '—',
    ]);
  });

  it('warns when the current state moved, without rewriting the snapshot', () => {
    renderMode('internal_detail');
    const group = document.querySelector('[data-group="grp-nextcloud"]') as HTMLElement;

    expect(screen.queryByText('Current state has changed since this request was submitted.')).not.toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: 'View details' }));

    expect(
      within(group).getByText('Current state has changed since this request was submitted.')
    ).toBeInTheDocument();
    const brice = within(group).getByText('Brice Mvondo').closest('tr') as HTMLElement;
    expect(within(brice).getByText('Active')).toBeInTheDocument();
  });

  it('shows the holder change on the target row and the people left unchanged on request', () => {
    renderMode('internal_detail');
    const holder = document.querySelector('[data-group="grp-holder"]') as HTMLElement;
    fireEvent.click(within(holder).getByRole('button', { name: 'View details' }));
    const row = within(within(holder).getByRole('table')).getAllByRole('row')[1];
    expect(row.textContent).toBe('Franck MbassiACI-LT-023Change holderHeld by Franck Mbassi');
    expect(within(holder).getAllByText('Franck Mbassi → Marie Dupont')).toHaveLength(1);
    expect(within(holder).getAllByText('NEW')).toHaveLength(1);

    const m365 = document.querySelector('[data-group="grp-m365"]') as HTMLElement;
    fireEvent.click(within(m365).getByRole('button', { name: 'View details' }));
    fireEvent.click(within(m365).getByRole('button', { name: 'View unchanged' }));
    expect(within(m365).getByText('Already has Microsoft 365')).toBeInTheDocument();
  });

  it('opens only the groups with several targets in internal review, and shows a decided single line on its row', () => {
    const presentation = presentationFixture();
    presentation.action_groups[3].targets[0] = {
      ...presentation.action_groups[3].targets[0],
      line_status: 'Rejected',
      rejection_reason: 'No licence left',
    };
    renderMode('internal_review', presentation);

    expect(document.querySelectorAll('[data-group] table')).toHaveLength(2);
    expect(document.querySelector('[data-group="grp-m365"] table')).not.toBeNull();
    expect(document.querySelector('[data-group="grp-nextcloud"] table')).not.toBeNull();
    const sophos = document.querySelector('[data-group="grp-sophos"]') as HTMLElement;
    expect(within(sophos).queryByRole('table')).not.toBeInTheDocument();
    expect(within(sophos).getAllByText('REJECTED')).toHaveLength(1);
    expect(within(sophos).getAllByText('No licence left')).toHaveLength(1);
    expect(within(sophos).queryByRole('button', { name: 'Reject all' })).not.toBeInTheDocument();

    fireEvent.click(within(sophos).getByRole('button', { name: 'View details' }));
    const table = within(sophos).getByRole('table');
    expect(within(table).queryByText('REJECTED')).not.toBeInTheDocument();
    expect(within(table).queryByRole('button')).not.toBeInTheDocument();
    expect(within(sophos).getAllByText('No licence left')).toHaveLength(1);
  });

  it('decides a single-target group from its row, with one Accept and one Reject for its own line', () => {
    const onTarget = vi.fn();
    render(
      wrap(
        <RequestPresentation
          presentation={presentationFixture()}
          mode="internal_review"
          renderGroupControls={() => <button type="button">Accept all</button>}
          renderTargetControls={(row) => (
            <>
              <button type="button" onClick={() => onTarget(row.line_idx)}>
                Accept
              </button>
              <button type="button">Reject</button>
            </>
          )}
        />
      )
    );

    for (const [key, idx] of [['grp-holder', 15], ['grp-sophos', 16]] as const) {
      const group = document.querySelector(`[data-group="${key}"]`) as HTMLElement;
      expect(within(group).queryByRole('table'), key).not.toBeInTheDocument();
      expect(within(group).getAllByRole('button', { name: 'Accept' }), key).toHaveLength(1);
      expect(within(group).getAllByRole('button', { name: 'Reject' }), key).toHaveLength(1);
      expect(within(group).queryByRole('button', { name: 'Accept all' }), key).not.toBeInTheDocument();
      fireEvent.click(within(group).getByRole('button', { name: 'Accept' }));
      expect(onTarget).toHaveBeenLastCalledWith(idx);
    }

    const m365 = document.querySelector('[data-group="grp-m365"]') as HTMLElement;
    expect(within(m365).getByRole('table')).toBeInTheDocument();
    expect(within(m365).getAllByRole('button', { name: 'Accept all' })).toHaveLength(1);
    expect(within(within(m365).getByRole('table')).getAllByRole('button', { name: 'Accept' })).toHaveLength(8);
  });
});

describe('completed detail', () => {
  it('keeps the requested intent and appends the outcome with its exact notes', () => {
    const onRecap = vi.fn();
    render(wrap(<RequestPresentation presentation={completedFixture()} mode="completed_detail" onViewExecutionRecap={onRecap} />));

    expect(screen.getByText('Add Sophos')).toBeInTheDocument();
    expect(screen.getByText('1 requested Device')).toBeInTheDocument();
    expect(screen.getAllByText('Marie Dupont').length).toBeGreaterThan(1);

    const outcome = section('fulfilment-outcome') as HTMLElement;
    expect(within(outcome).getByText('Persisted execution result')).toBeInTheDocument();
    expect(within(outcome).getByText('CU-1054')).toBeInTheDocument();
    expect(within(outcome).getByText('Created during fulfilment')).toBeInTheDocument();
    expect(within(outcome).getByText('ACI-LT-087')).toBeInTheDocument();
    expect(within(outcome).getByText('Existing Device selected')).toBeInTheDocument();
    expect(within(outcome).getByText('16 completed')).toBeInTheDocument();
    expect(within(outcome).getByText('0 unresolved')).toBeInTheDocument();
    expect(within(outcome).getByText('COMPLETED')).toBeInTheDocument();
    expect(within(outcome).getByRole('link', { name: 'View Client User' })).toHaveAttribute('href', '/msp/users/CU-1054');
    expect(within(outcome).getByRole('link', { name: 'View Device' })).toHaveAttribute('href', '/msp/devices/ACI-LT-087');

    fireEvent.click(within(outcome).getByRole('button', { name: 'View execution recap' }));
    expect(onRecap).toHaveBeenCalledTimes(1);

    const main = section('requested-actions') as HTMLElement;
    expect(main.compareDocumentPosition(outcome) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section('attention')).toBeNull();
    const info = section('request-information') as HTMLElement;
    expect(within(info).getByText('Completed · 28 Sep 2026')).toBeInTheDocument();
  });
});

describe('the approval bar', () => {
  it('asks for a reason with the exact copy before rejecting', () => {
    const onReject = vi.fn();
    const onApprove = vi.fn();
    render(<RequestApprovalBar onApprove={onApprove} onReject={onReject} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Reject request' })).toBeInTheDocument();
    expect(within(dialog).getByText('A reason is required and will be visible in the request history.')).toBeInTheDocument();
    expect(within(dialog).getByText('Reason *')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Reject request' });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Reason *'), { target: { value: '  Not this quarter ' } });
    fireEvent.click(confirm);

    expect(onReject).toHaveBeenCalledWith('Not this quarter');
    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve and send to Nexgen' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});
