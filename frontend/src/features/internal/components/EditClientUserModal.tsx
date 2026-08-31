import React, { useEffect, useState } from 'react';
import { AlertCircle, UserPen } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import type { UserDetail } from '@/lib/api/internal';
import { useUpdateClientUser } from '../hooks/useUsers';

type Props = {
  open: boolean;
  user: UserDetail['user'] | null;
  onClose: () => void;
};

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const EditClientUserModal: React.FC<Props> = ({ open, user, onClose }) => {
  const save = useUpdateClientUser();

  const [fullName, setFullName] = useState('');
  const [department, setDepartment] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [startDate, setStartDate] = useState('');
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    if (!open || !user) return;
    setFullName(user.full_name ?? '');
    setDepartment(user.department ?? '');
    setEmail(user.email ?? '');
    setUsername(user.username ?? '');
    setStartDate((user.start_date ?? '').slice(0, 10));
    setRemarks('');
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user]);

  const submit = async () => {
    try {
      await save.mutateAsync({
        name: user?.name as string,
        full_name: fullName,
        department,
        email,
        username,
        start_date: startDate,
        remarks,
      });
      onClose();
    } catch {
      // surfaced below
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={UserPen}
      tone="blue"
      title="Edit this person"
      subtitle={user?.customer ? `${user.customer} — what we hold about them.` : undefined}
      widthClass="max-w-2xl"
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
            onClick={submit}
            disabled={!fullName.trim() || save.isLoading}
            className="flex min-w-[7rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {save.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Save'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
          <div>
            <FieldLabel required>Full name</FieldLabel>
            <input
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>Department</FieldLabel>
            <input
              type="text"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>Email</FieldLabel>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>Username</FieldLabel>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="The account their licences are issued against"
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>Joined on</FieldLabel>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <FieldLabel>Add a note</FieldLabel>
          <textarea
            rows={3}
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            placeholder="Part-time from May, keeps the laptop."
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
          <p className="mt-1.5 text-sm text-slate-500">
            Added to their history — earlier notes are kept.
          </p>
        </div>

        <p className="text-sm text-slate-500">
          Their company and their status are not editable here: moving someone would orphan
          their services, and the status follows the services themselves.
        </p>

        {save.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{save.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default EditClientUserModal;
