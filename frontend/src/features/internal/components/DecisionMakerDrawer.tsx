import React, { useState } from 'react';
import {
  Building2,
  Check,
  ChevronRight,
  CircleCheck,
  Copy,
  ExternalLink,
  LayoutGrid,
  Lock,
  Minus,
  ShieldCheck,
  SquarePen,
  User,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTeamMember } from '../hooks/useTeam';
import type { Approver } from '@/lib/api/internal';

type Props = { open: boolean; customer: string; approver: Approver | null; onClose: () => void };

const fmt = (value?: string | null) => (value ? String(value).slice(0, 16) : 'Never');

const Card: React.FC<{ icon: typeof User; title: string; extra?: React.ReactNode; children: React.ReactNode }> = ({
  icon: Icon,
  title,
  extra,
  children,
}) => (
  <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
    <p className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100">
        <Icon size={16} strokeWidth={1.75} />
      </span>
      {title}
      {extra}
    </p>
    <div className="mt-3 divide-y divide-slate-100">{children}</div>
  </section>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start justify-between gap-4 py-2">
    <span className="text-sm text-slate-500">{label}</span>
    <span className="min-w-0 text-right text-sm font-medium text-slate-900">{children}</span>
  </div>
);

const Yes: React.FC<{ on: boolean }> = ({ on }) => (
  <span className={`inline-flex items-center gap-1.5 ${on ? 'text-slate-900' : 'text-slate-400'}`}>
    {on ? (
      <CircleCheck size={16} className="text-emerald-500" />
    ) : (
      <Minus size={16} className="text-slate-300" />
    )}
    {on ? 'Yes' : 'No'}
  </span>
);

/**
 * One decision-maker, read without leaving the customer.
 *
 * Everything here is read off their account: a line of the matrix says what they may decide,
 * never who they are. Changing any of it happens on the account itself, which the footer
 * opens — the drawer reads, it does not quietly become a second place to edit.
 */
const DecisionMakerDrawer: React.FC<Props> = ({ open, customer, approver, onClose }) => {
  const navigate = useNavigate();
  const member = useTeamMember(open && approver ? approver.user : undefined);
  const [tab, setTab] = useState<'overview' | 'rights'>('overview');
  const [copied, setCopied] = useState(false);

  if (!open || !approver) return null;

  const account = member.data;
  const scope = approver.department ? `${approver.department} Department` : 'Whole company';
  const granted = (account?.abilities.groups ?? []).flatMap((group) => group.items);
  const allowed = granted.filter((item) => item.allowed).length;

  const copy = () => {
    navigator.clipboard?.writeText(approver.user);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <aside
      role="dialog"
      aria-label={`${approver.full_name || approver.user} details`}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col bg-slate-50 shadow-2xl ring-1 ring-slate-200"
    >
      <header className="border-b border-slate-200 bg-white px-6 pb-0 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden
              className="grid size-11 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-blue-100"
            >
              <User size={20} strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="truncate text-xl font-semibold tracking-tight text-slate-900">
                {approver.full_name || approver.user}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                  approver.enabled === false
                    ? 'bg-slate-50 text-slate-600 ring-slate-200'
                    : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                }`}
              >
                <CircleCheck size={12} />
                {approver.enabled === false ? 'Disabled' : 'Active'}
              </span>
            </p>
            <p className="mt-1 truncate text-sm text-slate-500">{approver.user}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="grid size-9 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 flex gap-6">
          {(
            [
              ['overview', 'Overview'],
              ['rights', 'Access & Rights'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors ${
                tab === value
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-auto p-5">
        {tab === 'overview' && (
          <>
            <Card icon={User} title="Account information">
              <Row label="Name">{approver.full_name || '—'}</Row>
              <Row label="Email">
                <span className="inline-flex items-center gap-1.5">
                  <span className="truncate">{approver.user}</span>
                  <button
                    type="button"
                    onClick={copy}
                    aria-label="Copy the email address"
                    className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  >
                    {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                  </button>
                </span>
              </Row>
              <Row label="Role">
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
                  Decision Maker
                </span>
              </Row>
              <Row label="Account type">{account?.user_type ?? '—'}</Row>
              <Row label="Customer">
                <button
                  type="button"
                  onClick={() => navigate(`/msp/customers/${encodeURIComponent(customer)}`)}
                  className="font-medium text-blue-600 transition-colors hover:text-blue-700 hover:underline"
                >
                  {customer}
                </button>
              </Row>
              <Row label="Created on">{fmt(account?.creation)?.slice(0, 10)}</Row>
              <Row label="Last sign-in">{fmt(account?.last_login)}</Row>
              <Row label="Last seen">{fmt(account?.last_active)}</Row>
            </Card>

            <Card icon={ShieldCheck} title="Permissions">
              <Row label="Can submit requests">
                <Yes on={approver.can_submit} />
              </Row>
              <Row label="Can approve requests">
                <Yes on={approver.can_approve} />
              </Row>
              <Row label="Scope">
                <span className="inline-flex items-center gap-1.5">
                  <Building2 size={13} className="text-slate-400" />
                  {scope}
                </span>
              </Row>
              <Row label="Relationship">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                    approver.deciding === false
                      ? 'bg-slate-50 text-slate-600 ring-slate-200'
                      : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                  }`}
                >
                  {approver.status === 'Inactive'
                    ? 'Stood down'
                    : approver.deciding === false
                      ? approver.effective_to
                        ? 'Ended'
                        : 'Scheduled'
                      : 'Deciding'}
                </span>
              </Row>
              {(approver.effective_from || approver.effective_to) && (
                <Row label="In force">
                  {`${approver.effective_from ? String(approver.effective_from).slice(0, 10) : '—'} → ${
                    approver.effective_to ? String(approver.effective_to).slice(0, 10) : '—'
                  }`}
                </Row>
              )}
              <p className="mt-3 rounded-xl bg-slate-50/70 px-3 py-2.5 text-xs text-slate-600 ring-1 ring-slate-200/60">
                {approver.deciding === false
                  ? `This relationship is not in force, so they decide nothing for ${customer} at the moment.`
                  : approver.can_submit && approver.can_approve
                  ? `They can submit and approve requests for ${customer}. Their own requests are approved automatically.`
                  : approver.can_approve
                    ? `They can approve requests for ${customer}, but cannot raise one.`
                    : approver.can_submit
                      ? `Their requests wait for somebody at ${customer} who may approve.`
                      : `They decide nothing for ${customer} yet.`}
              </p>
            </Card>

            <Card icon={Lock} title="Security">
              <Row label="Two-factor authentication">
                <Yes on={Boolean(account?.two_factor)} />
              </Row>
              <Row label="Password last set">{fmt(account?.last_password_reset_date)?.slice(0, 10)}</Row>
              <Row label="Account status">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                    account?.enabled
                      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                      : 'bg-slate-50 text-slate-600 ring-slate-200'
                  }`}
                >
                  {account?.enabled ? 'Active' : 'Disabled'}
                </span>
              </Row>
            </Card>

            <button
              type="button"
              onClick={() => setTab('rights')}
              className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white p-5 text-left shadow-sm ring-1 ring-slate-200/70 transition-colors hover:bg-slate-50/80"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                    <LayoutGrid size={16} strokeWidth={1.75} />
                  </span>
                  Access and rights
                  <span className="font-normal text-slate-400">
                    ({allowed} of {granted.length})
                  </span>
                </span>
                <span className="mt-1.5 block truncate text-sm font-medium text-blue-600">
                  {account?.abilities.role_label ?? 'No role'} — acts for {account?.abilities.scope}
                </span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-slate-300" />
            </button>
          </>
        )}

        {tab === 'rights' &&
          (account ? (
            <div className="space-y-4">
              {account.abilities.groups.map((group) => (
                <Card key={group.title} icon={ShieldCheck} title={group.title}>
                  <ul className="divide-y divide-slate-100">
                    {group.items.map((item) => (
                      <li key={item.label} className="flex items-start gap-2.5 py-2">
                        {item.allowed ? (
                          <Check size={15} className="mt-0.5 shrink-0 text-blue-600" />
                        ) : (
                          <Minus size={15} className="mt-0.5 shrink-0 text-slate-300" />
                        )}
                        <span className="min-w-0">
                          <span
                            className={`block text-sm ${
                              item.allowed ? 'font-medium text-slate-800' : 'text-slate-400'
                            }`}
                          >
                            {item.label}
                          </span>
                          {item.detail && (
                            <span className="mt-0.5 block text-xs text-slate-500">{item.detail}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          ) : (
            <p className="px-1 text-sm text-slate-500">Reading their account…</p>
          ))}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-6 py-4">
        <button
          type="button"
          onClick={() => navigate(`/msp/accounts/${encodeURIComponent(approver.user)}`)}
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
        >
          <ExternalLink size={14} />
          Open full account
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(`/msp/accounts/${encodeURIComponent(approver.user)}`)}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
          >
            <SquarePen size={14} />
            Edit access
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
          >
            Close
          </button>
        </div>
      </footer>
    </aside>
  );
};

export default DecisionMakerDrawer;
