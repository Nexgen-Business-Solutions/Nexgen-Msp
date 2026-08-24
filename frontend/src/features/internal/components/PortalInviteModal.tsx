import React, { useEffect, useState } from 'react';
import { AlertCircle, Send, ShieldOff } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import type { UserDetail } from '@/lib/api/internal';
import { useInviteToPortal, useRevokePortalAccess } from '../hooks/useUsers';

type Props = {
  open: boolean;
  user: UserDetail['user'] | null;
  onClose: () => void;
};

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const PortalInviteModal: React.FC<Props> = ({ open, user, onClose }) => {
  const invite = useInviteToPortal();
  const revoke = useRevokePortalAccess();

  const [email, setEmail] = useState('');

  useEffect(() => {
    if (!open || !user) return;
    setEmail(user.email ?? '');
    invite.reset();
    revoke.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user]);

  const existing = Boolean(user?.portal_user);
  const error = (invite.error ?? revoke.error) as Error | undefined;
  const busy = invite.isLoading || revoke.isLoading;

  const send = async () => {
    try {
      await invite.mutateAsync({ name: user?.name as string, email });
      onClose();
    } catch {
      // surfaced below
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Send}
      tone="blue"
      title={existing ? 'Send a fresh invitation' : 'Invite to the portal'}
      subtitle={`${user?.full_name ?? ''} — access to ${user?.customer ?? 'their company'}'s portal.`}
      widthClass="max-w-2xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          {existing ? (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                try {
                  await revoke.mutateAsync(user?.name as string);
                  onClose();
                } catch {
                  // surfaced below
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
            >
              <ShieldOff size={15} />
              Revoke access
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={send}
              disabled={!email.trim() || busy}
              className="flex min-w-[8rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : existing ? (
                'Send again'
              ) : (
                'Send invitation'
              )}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <FieldLabel required>Email</FieldLabel>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </div>

        <p className="text-sm text-slate-500">
          {existing
            ? 'They already have access. Sending again replaces the previous link, which can only be used once.'
            : `They will receive a link to set their password, and will see only ${
                user?.customer ?? 'their company'
              }.`}
        </p>

        {error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default PortalInviteModal;
