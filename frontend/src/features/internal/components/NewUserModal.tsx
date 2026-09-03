import React, { useEffect, useState } from 'react';
import { AlertCircle, UserPlus } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import { useCreateClientUser } from '../hooks/useRequests';
import { useUserFilterOptions } from '../hooks/useUsers';

type Props = { open: boolean; onClose: () => void; onCreated: (clientUser: string) => void };

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const today = () => new Date().toISOString().slice(0, 10);

const NewUserModal: React.FC<Props> = ({ open, onClose, onCreated }) => {
  const options = useUserFilterOptions();
  const create = useCreateClientUser();

  const [customer, setCustomer] = useState('');
  const [fullName, setFullName] = useState('');
  const [department, setDepartment] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [startDate, setStartDate] = useState(today());

  useEffect(() => {
    if (!open) return;
    setCustomer('');
    setFullName('');
    setDepartment('');
    setEmail('');
    setUsername('');
    setStartDate(today());
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    try {
      const created = await create.mutateAsync({
        customer,
        full_name: fullName.trim(),
        department: department.trim() || undefined,
        email: email.trim() || undefined,
        username: username.trim() || undefined,
        start_date: startDate || undefined,
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
      title="Add a user"
      subtitle="Someone at a customer who will hold devices and services."
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
            disabled={!customer || !fullName.trim() || create.isLoading}
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
            <FieldLabel required>Customer</FieldLabel>
            <Select
              searchable
              className="w-full"
              value={customer}
              onChange={setCustomer}
              placeholder="Select a customer"
              options={(options.data?.customers ?? []).map((item) => ({
                value: item,
                label: item,
              }))}
            />
          </div>
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
            <FieldLabel>Department</FieldLabel>
            <input
              type="text"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              placeholder="Accounting"
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
              placeholder="If you already know it"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-400">
              The account name a licence is issued against. It can be filled in later, when the
              service is delivered.
            </p>
          </div>
          <div>
            <FieldLabel>In service since</FieldLabel>
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

export default NewUserModal;
