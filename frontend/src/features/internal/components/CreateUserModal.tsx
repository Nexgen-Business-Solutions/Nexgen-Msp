import React, { useEffect, useState } from 'react';
import { AlertCircle, UserPlus } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import { useCreateClientUser } from '../hooks/useRequests';

type Props = {
  open: boolean;
  request: string;
  customer: string;
  line: {
    idx: number;
    full_name: string | null;
    department: string | null;
    email: string | null;
    username: string | null;
  } | null;
  onCreated: (clientUser: string) => void;
  onClose: () => void;
};

const labelClass = 'mb-1.5 block text-xs font-semibold text-slate-700';
const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const today = () => new Date().toISOString().slice(0, 10);

const CreateUserModal: React.FC<Props> = ({
  open,
  request,
  customer,
  line,
  onCreated,
  onClose,
}) => {
  const create = useCreateClientUser();

  const [fullName, setFullName] = useState('');
  const [department, setDepartment] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [startDate, setStartDate] = useState(today());

  useEffect(() => {
    if (!open || !line) return;
    setFullName(line.full_name ?? '');
    setDepartment(line.department ?? '');
    setEmail(line.email ?? '');
    setUsername(line.username ?? '');
    setStartDate(today());
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, line]);

  const submit = async () => {
    if (!line) return;

    try {
      const created = await create.mutateAsync({
        customer,
        full_name: fullName.trim(),
        department: department.trim() || undefined,
        email: email.trim() || undefined,
        username: username.trim() || undefined,
        start_date: startDate || undefined,
        source_request: request,
        request_line: line.idx,
      });
      onCreated(created.name);
    } catch {
      // surfaced by the error banner below
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={UserPlus}
      tone="indigo"
      title="Create this user"
      subtitle={`Prefilled from line ${line?.idx ?? ''}. You will land on their profile with the request kept in context.`}
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
            disabled={!fullName.trim() || create.isLoading}
            className="flex min-w-[8rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {create.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Create and open'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel required>Full name</FieldLabel>
            <input
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Marie Dupont"
              className={inputClass}
            />
          </div>
          <div>
            <span className={labelClass}>Department</span>
            <input
              type="text"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              placeholder="Accounting"
              className={inputClass}
            />
          </div>
          <div>
            <span className={labelClass}>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Optional"
              className={inputClass}
            />
          </div>
          <div>
            <span className={labelClass}>Username</span>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Optional"
              className={inputClass}
            />
          </div>
          <div>
            <span className={labelClass}>In service since</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className={inputClass}
            />
          </div>
        </div>


        {create.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{create.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default CreateUserModal;
