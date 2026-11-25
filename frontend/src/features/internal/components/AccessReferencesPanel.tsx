import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, Minus, ShieldCheck, Wrench } from 'lucide-react';
import ConfirmModal from '@/shared/components/ConfirmModal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { AccountAbilities, AccountAccess } from '@/lib/api/internal';
import { useResolveAccountAccess, useTeamOptions } from '../hooks/useTeam';

type Props = { email: string; access: AccountAccess; abilities: AccountAbilities };

const NEEDS_REVIEW = ['MISSING_CUSTOMER_REFERENCE', 'CUSTOMER_REFERENCE_CONFLICT', 'ROLE_FAMILY_CONFLICT'];

const list = (customers: string[]) => (customers.length ? customers.join(', ') : 'None');

const article = (role: string) => ('AEIOU'.includes(role[0]?.toUpperCase() ?? '') ? 'an' : 'a');

/** One thing the account may or may not do, read off the rules rather than its role name. */
const Ability: React.FC<{ label: string; allowed: boolean; detail?: string | null }> = ({
  label,
  allowed,
  detail,
}) => (
  <li className="flex items-start gap-2.5 py-1.5">
    {allowed ? (
      <Check size={15} className="mt-0.5 shrink-0 text-blue-600" />
    ) : (
      <Minus size={15} className="mt-0.5 shrink-0 text-slate-300" />
    )}
    <span className="min-w-0">
      <span className={`block text-sm ${allowed ? 'font-medium text-slate-800' : 'text-slate-400'}`}>
        {label}
      </span>
      {detail && <span className="mt-0.5 block text-xs text-slate-500">{detail}</span>}
    </span>
  </li>
);

/**
 * What this account can do, and whether the Customer it answers for is recorded consistently.
 *
 * Folded away by default: the heading already says whether anything needs attention, and the
 * rights below are there for the question "what does this role actually reach?" — answered by
 * asking the rules about this very account, so nothing is promised that the code would refuse.
 */
const AccessReferencesPanel: React.FC<Props> = ({ email, access, abilities }) => {
  const resolve = useResolveAccountAccess(email);
  const options = useTeamOptions();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<'contact' | 'permission' | 'manual' | null>(null);
  const [manual, setManual] = useState('');

  const references = access.status !== 'NOT_CUSTOMER_ACCOUNT';
  const review = references && NEEDS_REVIEW.includes(access.status);
  const repaired = access.status.startsWith('REPAIRED_');
  const items = abilities.groups.flatMap((group) => group.items);
  const granted = items.filter((item) => item.allowed).length;
  const wanted =
    choice === 'contact'
      ? access.contact_customers
      : choice === 'permission'
        ? access.permission_customers
        : manual
          ? [manual]
          : [];

  // a company recorded on this account stays selectable even when the catalogue no longer offers it
  const companies = useMemo(
    () =>
      [
        ...new Set([
          ...(options.data?.customers ?? []),
          ...access.contact_customers,
          ...access.permission_customers,
        ]),
      ].sort(),
    [options.data, access.contact_customers, access.permission_customers]
  );

  const apply = async () => {
    if (wanted.length === 0) return;

    await resolve.mutateAsync(
      choice === 'manual'
        ? { email, customers: wanted }
        : { email, source: choice === 'contact' ? 'contact' : 'permission' }
    );
    setChoice(null);
  };

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? 'Hide access and rights' : 'Show access and rights'}
        className="flex w-full items-center gap-3.5 px-5 py-5 text-left transition-colors hover:bg-slate-50/80 sm:px-6"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
          <ShieldCheck className="size-5" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-slate-900">Access and rights</span>
            {review && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                Needs review
              </span>
            )}
            {repaired && (
              <span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                References repaired
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-sm text-slate-500">
            {abilities.role_label ?? 'No role'} · acts for {abilities.scope} · {granted} of{' '}
            {items.length} rights
          </span>
        </span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {access.status === 'STAFF_WITH_CUSTOMER_ROLE' && (
        <p className="border-t border-slate-100 px-5 py-3 text-sm text-slate-700 sm:px-6">{access.message}</p>
      )}

      {review && (
        <div className="mx-5 mb-5 rounded-2xl bg-amber-50 p-3.5 ring-1 ring-amber-200 sm:mx-6">
          <p className="text-sm font-semibold text-amber-900">Customer access needs review</p>
          <p className="mt-0.5 text-sm text-amber-900">
            The Customer references on this account do not agree. Access remains restricted until
            the references are corrected.
          </p>
          {access.message && <p className="mt-2 text-sm text-amber-900">{access.message}</p>}
        </div>
      )}

      {open && (
        <div className="space-y-6 border-t border-slate-100 px-5 py-5 sm:px-6">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {abilities.role_label
                ? `What ${article(abilities.role_label)} ${abilities.role_label} can do here`
                : 'What this account can do here'}
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {abilities.groups.map((group) => (
                <div key={group.title} className="rounded-xl bg-slate-50/70 px-4 py-3 ring-1 ring-slate-200/60">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    {group.title}
                  </p>
                  <ul className="mt-1.5">
                    {group.items.map((item) => (
                      <Ability
                        key={item.label}
                        label={item.label}
                        allowed={item.allowed}
                        detail={item.detail}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {references && (
            <dl className="grid gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                  Contact link
                </dt>
                <dd className="mt-0.5 text-slate-700">{list(access.contact_customers)}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                  User Permission
                </dt>
                <dd className="mt-0.5 text-slate-700">{list(access.permission_customers)}</dd>
              </div>
            </dl>
          )}

          {review && access.status !== 'ROLE_FAMILY_CONFLICT' && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setChoice('contact')}
                disabled={access.contact_customers.length === 0}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                Use the Contact link
              </button>
              <button
                type="button"
                onClick={() => setChoice('permission')}
                disabled={access.permission_customers.length === 0}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                Use the User Permission
              </button>
              <button
                type="button"
                onClick={() => {
                  setManual(access.contact_customers[0] ?? access.permission_customers[0] ?? '');
                  setChoice('manual');
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
              >
                <Wrench size={14} />
                Choose the company
              </button>
            </div>
          )}
        </div>
      )}

      {resolve.error instanceof Error && (
        <p className="mx-5 mb-5 rounded-2xl bg-red-50 px-3.5 py-3 text-sm font-medium text-red-700 ring-1 ring-red-200 sm:mx-6">
          {resolve.error.message}
        </p>
      )}

      <ConfirmModal
        open={choice !== null}
        title="Reconcile Customer access?"
        description="This account answers for one company. It will see that company and no other."
        confirmLabel="Apply access references"
        tone="info"
        loading={resolve.isLoading}
        onCancel={() => setChoice(null)}
        onConfirm={apply}
      >
        {choice === 'manual' ? (
          <div className="mt-3">
            <FieldLabel required>Company</FieldLabel>
            <Select
              className="w-full"
              searchable
              value={manual}
              onChange={setManual}
              placeholder="Select the company"
              options={companies.map((value) => ({ value, label: value }))}
            />
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-700">{list(wanted)}</p>
        )}
      </ConfirmModal>
    </section>
  );
};

export default AccessReferencesPanel;
