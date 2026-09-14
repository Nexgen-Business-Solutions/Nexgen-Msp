import React, { useEffect, useState } from 'react';
import { AlertCircle, Building2 } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { DepartmentRow } from '@/lib/api/internal';
import { useSaveDepartment } from '../hooks/useSettings';
import { useCustomerDirectory } from '../hooks/useCustomerDetails';

type Props = {
  open: boolean;
  department: DepartmentRow | null;
  onClose: () => void;
};

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const DepartmentModal: React.FC<Props> = ({ open, department, onClose }) => {
  const save = useSaveDepartment();
  const customers = useCustomerDirectory();

  const [departmentName, setDepartmentName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [sortOrder, setSortOrder] = useState('');
  const [customer, setCustomer] = useState('');

  useEffect(() => {
    if (!open) return;
    setDepartmentName(department?.department_name ?? '');
    setDescription(department?.description ?? '');
    setEnabled(department ? Boolean(department.enabled) : true);
    setSortOrder(department?.sort_order == null ? '' : String(department.sort_order));
    setCustomer(department?.customer ?? '');
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, department]);

  const submit = async () => {
    try {
      await save.mutateAsync({
        name: department?.name,
        department: {
          department_name: departmentName,
          description,
          enabled: enabled ? 1 : 0,
          sort_order: sortOrder === '' ? null : Number(sortOrder),
          customer,
        },
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
      icon={Building2}
      tone="blue"
      title={department ? 'Edit this department' : 'Add department'}
      subtitle={
        customer
          ? 'Offered to one customer only.'
          : 'A global department, shared by every customer.'
      }
      widthClass="max-w-lg"
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
            disabled={!departmentName.trim() || save.isLoading}
            className="flex min-w-[7rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {save.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : department ? (
              'Save'
            ) : (
              'Add department'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <FieldLabel required>Department name</FieldLabel>
          <input
            type="text"
            value={departmentName}
            onChange={(event) => setDepartmentName(event.target.value)}
            placeholder="Research & Development"
            className={inputClass}
          />
        </div>

        <div>
          <FieldLabel>Description</FieldLabel>
          <textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this department covers (optional)"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>

        <div>
          <FieldLabel>Customer</FieldLabel>
          <Select
            value={customer}
            onChange={setCustomer}
            searchable
            placeholder="All customers"
            options={[
              { value: '', label: 'All customers' },
              ...(customers.data ?? []).map((row) => ({
                value: row.name,
                label: row.customer_name || row.name,
              })),
              // a customer the directory no longer lists must still read back
              ...(department?.customer &&
              !(customers.data ?? []).some((row) => row.name === department.customer)
                ? [{ value: department.customer, label: department.customer }]
                : []),
            ]}
          />
          <p className="mt-1.5 text-xs text-slate-500">
            {customer
              ? 'Only this customer will see it in their forms. Everyone else will not.'
              : 'Leave it on all customers unless this department belongs to one company alone.'}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <FieldLabel>Display order</FieldLabel>
            <input
              type="number"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
              placeholder="Automatic"
              className={inputClass}
            />
          </div>
          <label className="mt-7 inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Available for selection
          </label>
        </div>

        {save.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="whitespace-pre-line text-sm font-medium text-red-700">
              {save.error.message}
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default DepartmentModal;
