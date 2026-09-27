import React, { useState } from 'react';
import { CircleCheck, ShieldAlert, Wrench } from 'lucide-react';
import ConfirmModal from '@/shared/components/ConfirmModal';
import type { AccountAccess } from '@/lib/api/internal';
import { useResolveAccountAccess } from '../hooks/useTeam';

type Props = { email: string; access: AccountAccess };

const LABEL: Record<string, string> = {
  HEALTHY: 'Access references healthy',
  REPAIRED_CONTACT_LINK: 'Access references repaired',
  REPAIRED_USER_PERMISSION: 'Access references repaired',
  MISSING_CUSTOMER_REFERENCE: 'Access references need review',
  CUSTOMER_REFERENCE_CONFLICT: 'Access references need review',
  ROLE_FAMILY_CONFLICT: 'Access references need review',
};

const TONE: Record<string, string> = {
  HEALTHY: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  REPAIRED_CONTACT_LINK: 'border-blue-200 bg-blue-50 text-blue-800',
  REPAIRED_USER_PERMISSION: 'border-blue-200 bg-blue-50 text-blue-800',
  MISSING_CUSTOMER_REFERENCE: 'border-amber-200 bg-amber-50 text-amber-900',
  CUSTOMER_REFERENCE_CONFLICT: 'border-amber-200 bg-amber-50 text-amber-900',
  ROLE_FAMILY_CONFLICT: 'border-amber-200 bg-amber-50 text-amber-900',
};

const NEEDS_REVIEW = ['MISSING_CUSTOMER_REFERENCE', 'CUSTOMER_REFERENCE_CONFLICT', 'ROLE_FAMILY_CONFLICT'];

const list = (customers: string[]) => (customers.length ? customers.join(', ') : 'None');

/** Whether the two Customer references of a customer account agree, and how to settle them. */
const AccessReferencesPanel: React.FC<Props> = ({ email, access }) => {
  const resolve = useResolveAccountAccess(email);
  const [choice, setChoice] = useState<'contact' | 'permission' | 'manual' | null>(null);
  const [manual, setManual] = useState('');

  if (access.status === 'NOT_CUSTOMER_ACCOUNT') return null;

  const review = NEEDS_REVIEW.includes(access.status);
  const wanted =
    choice === 'contact'
      ? access.contact_customers
      : choice === 'permission'
        ? access.permission_customers
        : manual
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean);

  const apply = async () => {
    await resolve.mutateAsync(
      choice === 'manual'
        ? { email, customers: wanted }
        : { email, source: choice === 'contact' ? 'contact' : 'permission' }
    );
    setChoice(null);
  };

  return (
    <section className={`rounded-xl border p-4 ${TONE[access.status] ?? 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex items-center gap-2 text-sm font-semibold">
          {review ? <ShieldAlert size={16} /> : <CircleCheck size={16} />}
          {LABEL[access.status] ?? 'Access references'}
        </p>
        {access.status === 'ROLE_FAMILY_CONFLICT' && <span className="text-xs font-medium">Role conflict</span>}
      </div>

      {review && (
        <>
          <p className="mt-2 text-sm font-semibold">Customer access needs review</p>
          <p className="mt-0.5 text-sm">
            The Customer references on this account do not agree. Access remains restricted until
            the references are corrected.
          </p>
          {access.message && <p className="mt-2 text-sm">{access.message}</p>}
        </>
      )}

      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide opacity-70">Contact links</dt>
          <dd className="mt-0.5">{list(access.contact_customers)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide opacity-70">User Permissions</dt>
          <dd className="mt-0.5">{list(access.permission_customers)}</dd>
        </div>
      </dl>

      {review && access.status !== 'ROLE_FAMILY_CONFLICT' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setChoice('contact')}
            disabled={access.contact_customers.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            Use Contact links
          </button>
          <button
            type="button"
            onClick={() => setChoice('permission')}
            disabled={access.permission_customers.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            Use User Permissions
          </button>
          <button
            type="button"
            onClick={() => {
              setManual(access.contact_customers.join(', '));
              setChoice('manual');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Wrench size={13} />
            Edit references manually
          </button>
        </div>
      )}

      {resolve.error instanceof Error && (
        <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {resolve.error.message}
        </p>
      )}

      <ConfirmModal
        open={choice !== null}
        title="Reconcile Customer access?"
        description="This changes which Customer records this account can access. Review the final Customer list before confirming."
        confirmLabel="Apply access references"
        tone="info"
        loading={resolve.isLoading}
        onCancel={() => setChoice(null)}
        onConfirm={apply}
      >
        {choice === 'manual' ? (
          <label className="mt-3 block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-700">Customers</span>
            <input
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              aria-label="Customers"
              placeholder="Customer A, Customer B"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            />
          </label>
        ) : (
          <p className="mt-3 text-sm text-slate-700">{list(wanted)}</p>
        )}
      </ConfirmModal>
    </section>
  );
};

export default AccessReferencesPanel;
