import React, { useState } from 'react';
import { UserPlus } from 'lucide-react';
import FieldLabel from '@/shared/components/FieldLabel';
import Modal from '@/shared/components/Modal';
import Select from '@/shared/components/Select';
import { useNewPersonContext } from '../hooks/usePortal';
import type { NewPersonValues } from '../hooks/useRequestBuilder';

const quietBtn =
  'rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50';
const primaryBtn =
  'rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60';
const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const OPTIONAL_FIELDS = [
  ['email', 'Email', 'text'],
  ['username', 'Username', 'text'],
  ['startDate', 'Start date', 'date'],
] as const;

type OptionalField = (typeof OPTIONAL_FIELDS)[number][0];

/**
 * Somebody the customer names who is not on file yet.
 *
 * The same form wherever they are named — from the People step, or from the machine that is
 * waiting for a holder — because it is the same person being described either way.
 */
const RequestNewPersonModal: React.FC<{
  onClose: () => void;
  onAdd: (values: NewPersonValues) => void;
}> = ({ onClose, onAdd }) => {
  const context = useNewPersonContext();
  const [fullName, setFullName] = useState('');
  const [department, setDepartment] = useState('');
  const [values, setValues] = useState<Record<OptionalField, string>>({
    email: '',
    username: '',
    startDate: '',
  });
  const [refused, setRefused] = useState(false);

  const add = () => {
    if (!fullName.trim()) {
      setRefused(true);

      return;
    }

    onAdd({ fullName, department, ...values });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={UserPlus}
      title="New person"
      subtitle="Fill what you have. Nexgen can complete the missing information during fulfilment."
      widthClass="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={quietBtn}>
            Cancel
          </button>
          <button type="button" onClick={add} className={primaryBtn}>
            Add person
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <FieldLabel required>Full name</FieldLabel>
          <input
            autoFocus
            value={fullName}
            aria-label="Full name"
            onChange={(event) => {
              setFullName(event.target.value);
              setRefused(false);
            }}
            className={inputClass}
          />
          {refused && (
            <p className="mt-1 text-xs font-medium text-red-600">Enter the person's full name.</p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel>Department</FieldLabel>
            <Select
              className="w-full"
              value={department}
              onChange={setDepartment}
              placeholder="No Department yet"
              options={(context.data?.departments ?? []).map((row) => ({
                value: row.value,
                label: row.label,
              }))}
            />
          </div>

          {OPTIONAL_FIELDS.map(([field, label, type]) => (
            <div key={field}>
              <FieldLabel>{label}</FieldLabel>
              <input
                type={type}
                value={values[field]}
                aria-label={label}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field]: event.target.value }))
                }
                className={inputClass}
              />
            </div>
          ))}
        </div>

        <p className="text-[11px] text-slate-500">Optional. Leave this blank if you do not know it.</p>
      </div>
    </Modal>
  );
};

export default RequestNewPersonModal;
