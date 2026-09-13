import React, { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { DeviceInterface } from '@/lib/api/internal';

type Props = {
  value: DeviceInterface[];
  onChange: (next: DeviceInterface[]) => void;
  /** names suggested for the key; the technician may type any other */
  suggestions?: string[];
  addLabel?: string;
};

const field =
  'h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

/**
 * A machine's network interfaces, as pairs of a name and a value. One layout for every form,
 * so the two fields always fit side by side inside the dialog, whatever its width.
 */
const InterfaceEditor: React.FC<Props> = ({
  value,
  onChange,
  suggestions = ['Wi-Fi', 'LAN'],
  addLabel = 'Add interface',
}) => {
  const listId = useId();

  const patch = (position: number, next: Partial<DeviceInterface>) =>
    onChange(value.map((item, index) => (index === position ? { ...item, ...next } : item)));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-slate-700">Network interfaces</span>
        <button
          type="button"
          onClick={() => onChange([...value, { interface_type: '', mac_address: '' }])}
          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 transition-colors hover:text-blue-700"
        >
          <Plus size={13} />
          {addLabel}
        </button>
      </div>

      <datalist id={listId}>
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {value.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-center text-xs text-slate-400">
          No interface recorded.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,3fr)_2.5rem] gap-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:grid">
            <span>Name</span>
            <span>Value</span>
            <span />
          </div>
          {value.map((item, position) => (
            <div
              key={position}
              className="grid grid-cols-[minmax(0,1fr)_2.5rem] gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_2.5rem]"
            >
              <input
                type="text"
                list={listId}
                value={item.interface_type}
                onChange={(event) => patch(position, { interface_type: event.target.value })}
                placeholder="Wi-Fi, LAN, Custom MAC…"
                aria-label={`Interface ${position + 1} name`}
                className={`${field} col-span-1`}
              />
              <input
                type="text"
                value={item.mac_address}
                onChange={(event) => patch(position, { mac_address: event.target.value })}
                placeholder="AA-BB-CC-DD-EE-FF"
                aria-label={`Interface ${position + 1} value`}
                className={`${field} col-start-1 row-start-2 font-mono sm:col-start-auto sm:row-start-auto`}
              />
              <button
                type="button"
                onClick={() => onChange(value.filter((_, index) => index !== position))}
                aria-label={`Remove interface ${position + 1}`}
                className="col-start-2 row-span-2 row-start-1 flex h-10 w-10 items-center justify-center self-start rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 sm:col-start-auto sm:row-span-1 sm:row-start-auto"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default InterfaceEditor;
