import React, { useEffect, useState } from 'react';
import { AlertCircle, UserPlus } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import { useInviteTeamMember, useTeamOptions } from '../hooks/useTeam';

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const ROLE_BLURB: Record<string, string> = {
  'MSP System Admin': 'Everything, including billing, contracts, settings and the Frappe desk.',
  'MSP Technician': 'Requests, people, devices and services. No billing, no desk.',
};

const InviteTeamModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const options = useTeamOptions();
  const invite = useInviteTeamMember();

  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState('MSP Technician');
  const [sendEmail, setSendEmail] = useState(true);

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setFirstName('');
    setLastName('');
    setRole('MSP Technician');
    setSendEmail(true);
    invite.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const valid = email.includes('@') && firstName.trim().length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={UserPlus}
      tone="blue"
      title="Add someone to the team"
      subtitle="They receive a link to choose their own password — no password is set here."
      widthClass="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid || invite.isLoading}
            onClick={async () => {
              await invite.mutateAsync({
                email: email.trim(),
                first_name: firstName.trim(),
                last_name: lastName.trim() || undefined,
                role,
                send_email: sendEmail ? 1 : 0,
              });
              onClose();
            }}
            className="flex min-w-[8rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {invite.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Send the invitation'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
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
            <FieldLabel required>Work email</FieldLabel>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="marie.dupont@nxgensolutions.com"
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <FieldLabel required>Role</FieldLabel>
            <Select
              className="w-full"
              value={role}
              onChange={setRole}
              options={(options.data?.roles ?? []).map((value) => ({
                value,
                label: value,
                description: ROLE_BLURB[value],
              }))}
            />
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

        {invite.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{invite.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default InviteTeamModal;
