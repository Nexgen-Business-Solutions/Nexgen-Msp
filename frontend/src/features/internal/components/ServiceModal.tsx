import React, { useEffect, useState } from 'react';
import { AlertCircle, Package } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { CatalogueRow } from '@/lib/api/internal';
import { useCatalogueOptions, useSaveService } from '../hooks/useCatalogue';

type Props = { open: boolean; service: CatalogueRow | null; onClose: () => void };

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const SCOPE_HINT: Record<string, string> = {
  User: 'One licence per person',
  Device: 'One licence per machine',
  Both: 'The technician chooses at assignment',
};

const ServiceModal: React.FC<Props> = ({ open, service, onClose }) => {
  const options = useCatalogueOptions();
  const save = useSaveService();

  const [code, setCode] = useState('');
  const [itemName, setItemName] = useState('');
  const [scope, setScope] = useState('User');
  const [uom, setUom] = useState('Unit');
  const [description, setDescription] = useState('');

  const editing = Boolean(service);

  useEffect(() => {
    if (!open) return;
    setCode(service?.name ?? '');
    setItemName(service?.item_name ?? '');
    setScope(service?.scope ?? 'User');
    setUom(service?.stock_uom ?? 'Unit');
    setDescription(service?.description ?? '');
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, service]);

  const submit = async () => {
    try {
      await save.mutateAsync({
        name: service?.name,
        item_code: editing ? undefined : code.trim(),
        item_name: itemName.trim(),
        scope,
        uom: editing ? undefined : uom,
        description: description.trim() || undefined,
      });
      onClose();
    } catch {
      // surfaced by the error banner below
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Package}
      tone="blue"
      title={editing ? 'Edit this service' : 'New service'}
      subtitle={
        editing
          ? `${service?.name} · ${service?.open_assignments} open assignment(s)`
          : 'What Nexgen can sell and bill.'
      }
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
            disabled={!itemName.trim() || (!editing && !code.trim()) || save.isLoading}
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
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel required>Service code</FieldLabel>
            <input
              type="text"
              value={code}
              disabled={editing}
              onChange={(event) => setCode(event.target.value)}
              placeholder="SVC-M365"
              className={`${inputClass} uppercase ${editing ? 'bg-slate-50 text-slate-500' : ''}`}
            />
          </div>
          <div>
            <FieldLabel required>Name</FieldLabel>
            <input
              type="text"
              value={itemName}
              onChange={(event) => setItemName(event.target.value)}
              placeholder="Microsoft 365 Business"
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel required>Billed per</FieldLabel>
            <Select
              className="w-full"
              value={scope}
              onChange={setScope}
              options={(options.data?.scopes ?? ['User', 'Device', 'Both']).map((item) => ({
                value: item,
                label: item,
                description: SCOPE_HINT[item],
              }))}
            />
          </div>
          <div>
            <FieldLabel>Unit</FieldLabel>
            <Select
              className="w-full"
              value={uom}
              onChange={setUom}
              options={(options.data?.uoms ?? ['Unit']).map((item) => ({
                value: item,
                label: item,
              }))}
            />
          </div>
        </div>

        <div>
          <FieldLabel>Description</FieldLabel>
          <textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What the customer gets."
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>

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

export default ServiceModal;
