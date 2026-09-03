import React, { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import Select from '@/shared/components/Select';
import FieldLabel from '@/shared/components/FieldLabel';
import { useCreateAccount, useTeamOptions } from '../hooks/useTeam';

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const KINDS = [
  {
    value: 'customer',
    label: 'Customer account',
    description: 'Someone at a company we serve. They see only that company.',
  },
  {
    value: 'internal',
    label: 'Nexgen account',
    description: 'One of our own. They work across every customer.',
  },
] as const;

const ROLE_BLURB: Record<string, string> = {
  'MSP Customer Operator': 'Everything at their company except the invoices.',
  'MSP Customer Manager': 'Everything at their company, invoices included.',
  'MSP Technician': 'Requests, people, devices and services. No billing, no desk.',
  'MSP System Admin': 'Everything, including billing, contracts, settings and the Frappe desk.',
};

const ADMIN_ROLE = 'MSP System Admin';

/** The one place an account is opened: who they are, which side they are on, and one role. */
const InviteTeamModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const options = useTeamOptions();
  const create = useCreateAccount();

  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [kind, setKind] = useState<'internal' | 'customer'>('customer');
  const [role, setRole] = useState('');
  const [customer, setCustomer] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [adminUnderstood, setAdminUnderstood] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setFirstName('');
    setLastName('');
    setKind('customer');
    setRole('');
    setCustomer('');
    setSendEmail(true);
    setAdminUnderstood(false);
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const roles =
    kind === 'internal' ? options.data?.internal_roles ?? [] : options.data?.customer_roles ?? [];

  const valid =
    email.includes('@') &&
    firstName.trim().length > 0 &&
    Boolean(role) &&
    (kind === 'internal' || Boolean(customer)) &&
    (role !== ADMIN_ROLE || adminUnderstood);

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={UserPlus}
      tone="blue"
      title="Open an account"
      subtitle="They receive a link to choose their own password — no password is set here."
      widthClass="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid || create.isLoading}
            onClick={async () => {
              await create.mutateAsync({
                email: email.trim(),
                first_name: firstName.trim(),
                last_name: lastName.trim() || undefined,
                kind,
                role,
                customer: kind === 'customer' ? customer : undefined,
                send_email: sendEmail ? 1 : 0,
              });
              onClose();
            }}
            className="flex min-w-[8rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {create.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Create the account'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel required>First name</FieldLabel>
            <input
              type="text"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              placeholder="Marie"
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>Last name</FieldLabel>
            <input
              type="text"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              placeholder="Dupont"
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <FieldLabel required>Email</FieldLabel>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="marie.dupont@company.com"
              className={inputClass}
            />
          </div>

          <div className="sm:col-span-2">
            <FieldLabel required>Who is this for?</FieldLabel>
            <Select
              className="w-full"
              value={kind}
              onChange={(value) => {
                setKind(value as 'internal' | 'customer');
                // the two families share no role, so a stale choice must not survive
                setRole('');
                setAdminUnderstood(false);
              }}
              options={KINDS.map((entry) => ({ ...entry }))}
            />
          </div>

          {kind === 'customer' && (
            <div className="sm:col-span-2">
              <FieldLabel required>Which company?</FieldLabel>
              <Select
                className="w-full"
                searchable
                value={customer}
                onChange={setCustomer}
                placeholder="Select the customer"
                options={(options.data?.customers ?? []).map((value) => ({ value, label: value }))}
              />
              <p className="mt-1 text-xs text-slate-400">
                Their access is bound to it: they see this company and no other.
              </p>
            </div>
          )}

          <div className="sm:col-span-2">
            <FieldLabel required>Role</FieldLabel>
            <Select
              className="w-full"
              value={role}
              onChange={(value) => {
                setRole(value);
                setAdminUnderstood(false);
              }}
              placeholder="Choose a role"
              options={roles.map((entry) => ({
                value: entry.value,
                label: entry.label,
                description: ROLE_BLURB[entry.value],
              }))}
            />
            {role === ADMIN_ROLE && (
              <label className="mt-2.5 flex cursor-pointer items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <input
                  type="checkbox"
                  checked={adminUnderstood}
                  onChange={(event) => setAdminUnderstood(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-300"
                />
                <span className="text-sm text-amber-800">
                  <span className="font-semibold">This grants full administration.</span> They will
                  see every customer's billing, the accounts of your team and the Frappe desk.
                </span>
              </label>
            )}
          </div>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={(event) => setSendEmail(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span className="text-sm text-slate-700">Email them the invitation now</span>
        </label>

        {create.error instanceof Error && (
          <p className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-700">
            {create.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
};

export default InviteTeamModal;
