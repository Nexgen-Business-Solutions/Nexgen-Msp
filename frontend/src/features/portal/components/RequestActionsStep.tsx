import React, { useMemo, useState } from 'react';
import { ArrowRightLeft, Info, Laptop, Layers, PackageOpen, Users, X } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import Select from '@/shared/components/Select';
import type {
  RequestExclusion,
  RequestOperationOption,
  RequestServiceOption,
  RequestSubjectRow,
  RequestTarget,
} from '@/lib/api/portal';
import { askedAmong, askedFrom, askedIndex, keyOf } from '../askedScope';
import { useRequestOperations, useRequestScope } from '../hooks/usePortal';
import type { useRequestBuilder } from '../hooks/useRequestBuilder';

type Builder = ReturnType<typeof useRequestBuilder>;
type Scope = { type: 'All' | 'Department' | 'Person'; key: string | null; label: string };

const quietBtn =
  'rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50';
const primaryBtn =
  'rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60';
const quickBtn =
  'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50';
const quickPrimary =
  'rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-100';

const Th: React.FC<{ children?: React.ReactNode; align?: 'left' | 'right' }> = ({
  children,
  align = 'left',
}) => (
  <th
    className={`whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 ${
      align === 'right' ? 'text-right' : 'text-left'
    }`}
  >
    {children}
  </th>
);

/** One entry of the left rail: a group of people, or one person. */
const Nav: React.FC<{
  active: boolean;
  title: string;
  hint: string;
  count?: number;
  badge?: boolean;
  onClick: () => void;
}> = ({ active, title, hint, count, badge, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-current={active ? 'true' : undefined}
    className={`mx-2 flex w-[calc(100%-1rem)] items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors ${
      active
        ? 'border-blue-200 bg-blue-50'
        : 'border-transparent bg-white hover:bg-slate-50'
    }`}
  >
    <span className="min-w-0">
      <span className="flex items-center gap-1.5">
        <span className="block truncate text-xs font-semibold text-slate-900">{title}</span>
        {badge && (
          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">
            NEW
          </span>
        )}
      </span>
      <span className="mt-0.5 block truncate text-[10px] text-slate-500">{hint}</span>
    </span>
    {count !== undefined && (
      <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
        {count}
      </span>
    )}
  </button>
);

/** The exact impact of one grouped service action, target by target. */
const ServiceImpact: React.FC<{
  option: RequestOperationOption;
  scope: Scope;
  selectedSubjectCount: number;
  serviceItem: string;
  asked: Set<string>;
  onClose: () => void;
  onAdd: (targets: RequestTarget[], exclusions: RequestExclusion[]) => void;
}> = ({ option, scope, selectedSubjectCount, serviceItem, asked, onClose, onAdd }) => {
  // what this request already asks for is unticked and locked: asking twice is one line, not two
  const [kept, setKept] = useState(
    () => new Set(option.targets.map(keyOf).filter((key) => !asked.has(key)))
  );
  const rows = [
    ...option.targets.map((target) => ({ target, exclusion: null as RequestExclusion | null })),
    ...option.exclusions.map((exclusion) => ({ target: null as RequestTarget | null, exclusion })),
  ];

  return (
    <Modal
      open
      onClose={onClose}
      icon={Layers}
      title={option.operation_label_snapshot}
      subtitle={`${option.applicable_subject_count} of ${selectedSubjectCount} people are applicable.`}
      widthClass="max-w-3xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={quietBtn}>
            Cancel
          </button>
          <button
            type="button"
            disabled={kept.size === 0}
            onClick={() =>
              onAdd(
                option.targets.filter((target) => kept.has(keyOf(target))),
                option.exclusions
              )
            }
            className={primaryBtn}
          >
            Add action
          </button>
        </div>
      }
    >
      <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              <Th />
              <Th>Person</Th>
              <Th>Current state</Th>
              <Th>Result</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ target, exclusion }, index) => {
              const id = target ? keyOf(target) : `x${index}`;
              const name = target?.full_name ?? exclusion?.full_name ?? '';
              const device = target?.device_label ?? exclusion?.device_label;

              return (
                <tr key={id}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Include ${name}`}
                      disabled={!target || asked.has(id)}
                      checked={Boolean(target) && kept.has(id)}
                      onChange={(event) =>
                        setKept((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(id);
                          else next.delete(id);
                          return next;
                        })
                      }
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 disabled:opacity-40"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-sm font-medium text-slate-900">{name}</span>
                    {device && <span className="ml-1.5 text-xs text-slate-500">{device}</span>}
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-600">
                    {asked.has(id) ? 'already asked in this request' : target?.current_state ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    {target ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        Will apply
                      </span>
                    ) : (
                      <span
                        title={exclusion?.reason}
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600"
                      >
                        Left unchanged
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        {scope.label} · {serviceItem}
      </p>
    </Modal>
  );
};

/** One new holder per Device, and nothing for the Devices left alone. */
const Transfers: React.FC<{
  option: RequestOperationOption;
  onClose: () => void;
  onAdd: (targets: RequestTarget[]) => void;
}> = ({ option, onClose, onAdd }) => {
  const [holders, setHolders] = useState<Record<string, string>>({});
  const chosen = option.targets.filter(
    (target) => holders[target.managed_device ?? ''] && holders[target.managed_device ?? ''] !== ''
  );

  return (
    <Modal
      open
      onClose={onClose}
      icon={ArrowRightLeft}
      title="Configure holder changes"
      subtitle="Define only the new holder that differs for each Device."
      widthClass="max-w-3xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={quietBtn}>
            Cancel
          </button>
          <button
            type="button"
            disabled={chosen.length === 0}
            onClick={() =>
              onAdd(
                chosen.map((target) => ({
                  ...target,
                  requested_holder: holders[target.managed_device ?? ''],
                }))
              )
            }
            className={primaryBtn}
          >
            Add configured transfers
          </button>
        </div>
      }
    >
      <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              <Th>Device</Th>
              <Th>Current holder</Th>
              <Th>New holder</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {option.targets.map((target) => (
              <tr key={target.managed_device}>
                <td className="px-3 py-2 text-sm font-medium text-slate-900">
                  {target.device_label}
                </td>
                <td className="px-3 py-2 text-sm text-slate-600">{target.full_name}</td>
                <td className="px-3 py-2">
                  <Select
                    className="w-56"
                    value={holders[target.managed_device ?? ''] ?? ''}
                    onChange={(value) =>
                      setHolders((current) => ({
                        ...current,
                        [target.managed_device ?? '']: value,
                      }))
                    }
                    placeholder="No change"
                    // everybody but whoever holds it today: handing it to its own holder
                    // would be no change at all
                    options={(option.holder_options ?? [])
                      .filter((holder) => holder.value !== target.current_holder)
                      .map((holder) => ({
                        value: holder.value,
                        label: holder.label,
                        description: holder.description ?? undefined,
                      }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
};

/** Which of the Devices in scope should go back to stock. */
/** Asking for a machine: the person is the target, and which machine it is may be left open. */
const AssignDevice: React.FC<{
  option: RequestOperationOption;
  onClose: () => void;
  onAdd: (targets: RequestTarget[]) => void;
}> = ({ option, onClose, onAdd }) => {
  const [kept, setKept] = useState(() => new Set(option.targets.map(keyOf)));
  const [choice, setChoice] = useState<Record<string, 'stock' | 'new'>>({});
  const [stock, setStock] = useState<Record<string, string>>({});
  const [described, setDescribed] = useState<
    Record<string, { hostname?: string; type?: string; serial?: string }>
  >({});

  const stockOptions = (option.stock_options ?? []).map((row) => ({
    value: row.value,
    label: row.label,
    description: row.description ?? undefined,
  }));

  const settled = (target: RequestTarget): RequestTarget => {
    const id = keyOf(target);
    const how = choice[id] ?? 'stock';

    if (how === 'stock' && stock[id]) {
      const picked = stockOptions.find((row) => row.value === stock[id]);

      return { ...target, managed_device: stock[id], device_label: picked?.label ?? null };
    }

    if (how === 'new') {
      const said = described[id] ?? {};

      return {
        ...target,
        new_device_label: said.hostname?.trim() || null,
        new_device_type: said.type?.trim() || null,
        new_device_serial: said.serial?.trim() || null,
      };
    }

    return target;
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={Laptop}
      title="Ask for a Device"
      subtitle={`${option.without_device_count ?? 0} of ${option.targets.length} selected hold no Device.`}
      widthClass="max-w-3xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={quietBtn}>
            Cancel
          </button>
          <button
            type="button"
            disabled={kept.size === 0}
            onClick={() =>
              onAdd(option.targets.filter((target) => kept.has(keyOf(target))).map(settled))
            }
            className={primaryBtn}
          >
            Add action
          </button>
        </div>
      }
    >
      <p className="mb-3 text-xs text-slate-500">
        Name one the company already has, or describe one that does not exist yet. What you
        describe is not required to be complete.
      </p>

      <div className="max-h-[26rem] overflow-auto rounded-lg border border-slate-200">
        <table className="w-full">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              <Th />
              <Th>Person</Th>
              <Th>Holds today</Th>
              <Th>Which Device</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {option.targets.map((target) => {
              const id = keyOf(target);
              const how = choice[id] ?? 'stock';
              const on = kept.has(id);

              return (
                <tr key={id}>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="checkbox"
                      aria-label={`Include ${target.full_name}`}
                      checked={on}
                      onChange={(event) =>
                        setKept((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(id);
                          else next.delete(id);
                          return next;
                        })
                      }
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                    />
                  </td>
                  <td className="px-3 py-2 align-top text-sm font-medium text-slate-900">
                    {target.full_name}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-slate-500">
                    {target.device_label ?? 'No Device'}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Select
                      className="w-full"
                      value={how}
                      onChange={(value) =>
                        setChoice((current) => ({
                          ...current,
                          [id]: value as 'stock' | 'new',
                        }))
                      }
                      options={[
                        { value: 'stock', label: 'One already exist' },
                        { value: 'new', label: 'A new one' },
                      ]}
                    />

                    {on && how === 'stock' && (
                      <Select
                        searchable
                        className="mt-2 w-full"
                        value={stock[id] ?? ''}
                        onChange={(value) =>
                          setStock((current) => ({ ...current, [id]: value }))
                        }
                        placeholder={
                          stockOptions.length ? 'Pick a Device' : 'No Device on file yet'
                        }
                        options={stockOptions}
                      />
                    )}

                    {on && how === 'new' && (
                      <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                        {(
                          [
                            ['hostname', 'Hostname'],
                            ['serial', 'Serial number'],
                          ] as const
                        ).map(([field, label]) => (
                          <input
                            key={field}
                            value={described[id]?.[field] ?? ''}
                            aria-label={`${label} for ${target.full_name}`}
                            placeholder={label}
                            onChange={(event) =>
                              setDescribed((current) => ({
                                ...current,
                                [id]: { ...current[id], [field]: event.target.value },
                              }))
                            }
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                          />
                        ))}

                        <Select
                          className="w-full"
                          value={described[id]?.type ?? ''}
                          onChange={(value) =>
                            setDescribed((current) => ({
                              ...current,
                              [id]: { ...current[id], type: value },
                            }))
                          }
                          placeholder="Type"
                          options={(option.device_types ?? []).map((type) => ({
                            value: type,
                            label: type,
                          }))}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
};

const ReturnToStock: React.FC<{
  option: RequestOperationOption;
  onClose: () => void;
  onAdd: (targets: RequestTarget[]) => void;
}> = ({ option, onClose, onAdd }) => {
  const [kept, setKept] = useState(() => new Set(option.targets.map(keyOf)));

  return (
    <Modal
      open
      onClose={onClose}
      icon={PackageOpen}
      title="Return to stock"
      subtitle={`${option.targets.length} current Device(s) are available in this scope.`}
      widthClass="max-w-2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={quietBtn}>
            Cancel
          </button>
          <button
            type="button"
            disabled={kept.size === 0}
            onClick={() => onAdd(option.targets.filter((target) => kept.has(keyOf(target))))}
            className={primaryBtn}
          >
            Add action
          </button>
        </div>
      }
    >
      <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              <Th />
              <Th>Device</Th>
              <Th>Current holder</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {option.targets.map((target) => {
              const id = keyOf(target);

              return (
                <tr key={id}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Include ${target.device_label}`}
                      checked={kept.has(id)}
                      onChange={(event) =>
                        setKept((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(id);
                          else next.delete(id);
                          return next;
                        })
                      }
                      className="h-4 w-4 rounded border-slate-300 text-blue-600"
                    />
                  </td>
                  <td className="px-3 py-2 text-sm font-medium text-slate-900">
                    {target.device_label}
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-600">{target.full_name}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
};

/** The people the current scope stands for, read rather than guessed. */
const ScopePeople: React.FC<{ rows: RequestSubjectRow[]; onClose: () => void }> = ({
  rows,
  onClose,
}) => (
  <Modal
    open
    onClose={onClose}
    icon={Users}
    title="People in scope"
    subtitle={`${rows.length} person(s)`}
    widthClass="max-w-3xl"
    footer={
      <div className="flex items-center justify-end">
        <button type="button" onClick={onClose} className={primaryBtn}>
          Done
        </button>
      </div>
    }
  >
    <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
      <table className="w-full">
        <thead className="sticky top-0 bg-slate-50">
          <tr>
            <Th>Person</Th>
            <Th>Devices</Th>
            <Th>Current services</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.subject_key}>
              <td className="px-3 py-2">
                <p className="text-sm font-medium text-slate-900">{row.full_name}</p>
                <p className="text-[11px] text-slate-500">{row.department || 'No Department'}</p>
              </td>
              <td className="px-3 py-2 text-sm text-slate-600">
                {row.devices.map((device) => device.label).join(', ') || '—'}
              </td>
              <td className="px-3 py-2 text-sm text-slate-600">
                {row.current_services.map((service) => service.label).join(', ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Modal>
);


/**
 * What the customer wants done, for everybody at once, one Department, or one person.
 *
 * The rail chooses the scope; the workspace shows only the acts at least one target in that
 * scope can actually use. Nothing here decides eligibility: the server says which targets an
 * act reaches and why it misses the others, and the customer sees that exact list before the
 * action is added.
 */
const RequestActionsStep: React.FC<{ builder: Builder }> = ({ builder }) => {
  const [scope, setScope] = useState<Scope>({ type: 'All', key: null, label: 'All selected' });
  const [reading, setReading] = useState(false);
  const [service, setService] = useState<{
    option: RequestOperationOption;
    card: RequestServiceOption;
  } | null>(null);
  const [device, setDevice] = useState<RequestOperationOption | null>(null);

  const projection = useRequestScope(builder.subjectDrafts);
  const rows = useMemo(() => projection.data?.subjects ?? [], [projection.data]);

  const scoped = useMemo(() => {
    if (scope.type === 'Person') return rows.filter((row) => row.subject_key === scope.key);
    if (scope.type === 'Department') return rows.filter((row) => row.department === scope.key);

    return rows;
  }, [rows, scope]);

  const operations = useRequestOperations(
    builder.subjectDrafts,
    scoped.map((row) => row.subject_key),
    builder.groupDrafts
  );
  const domains = operations.data?.domains ?? [];
  const departments = [...new Set(rows.map((row) => row.department).filter(Boolean) as string[])];
  const person = scope.type === 'Person' ? scoped[0] : null;

  /**
   * The targets an act already covers in this request.
   *
   * Nothing stopped the same act being added twice for the same person, and the recap then
   * showed it twice — two identical lines for one thing the customer wants once.
   */
  const alreadyAsked = useMemo(() => askedIndex(builder.actionGroups), [builder.actionGroups]);

  const askedHere = (
    targets: RequestTarget[],
    operationCode: string,
    serviceItem?: string | null
  ) => askedAmong(alreadyAsked, targets, operationCode, serviceItem);

  const add = (
    option: RequestOperationOption,
    targets: RequestTarget[],
    exclusions: RequestExclusion[],
    domain: 'Service' | 'Device',
    serviceItem?: string | null
  ) => {
    builder.addActionGroup({
      operationCode: option.operation_code,
      operationLabelSnapshot: option.operation_label_snapshot,
      domain,
      serviceItem: serviceItem ?? null,
      sourceScopeType: scope.type,
      sourceScopeKey: scope.key,
      sourceScopeLabel: scope.label,
      selectedSubjectCount: scoped.length,
      targets,
      exclusions,
    });
    setService(null);
    setDevice(null);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <p className="text-xs font-semibold text-slate-900">Apply actions to</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Choose a scope. The right side adapts.
          </p>
        </div>

        <div className="max-h-[32rem] overflow-auto pb-2">
          <p className="px-4 pb-1 pt-3 text-[9px] font-bold uppercase tracking-wider text-slate-400">
            Groups
          </p>
          <Nav
            active={scope.type === 'All'}
            title="All selected"
            hint="Current selection"
            count={rows.length}
            onClick={() => setScope({ type: 'All', key: null, label: 'All selected' })}
          />
          {departments.map((department) => (
            <Nav
              key={department}
              active={scope.type === 'Department' && scope.key === department}
              title={department}
              hint="Department"
              count={rows.filter((row) => row.department === department).length}
              onClick={() =>
                setScope({ type: 'Department', key: department, label: department })
              }
            />
          ))}

          <p className="px-4 pb-1 pt-3 text-[9px] font-bold uppercase tracking-wider text-slate-400">
            People
          </p>
          {rows.map((row) => (
            <Nav
              key={row.subject_key}
              active={scope.type === 'Person' && scope.key === row.subject_key}
              title={row.full_name || 'New person'}
              hint={`${row.devices.length} Devices · ${row.current_services.length} current services`}
              badge={row.is_new_user === 1}
              onClick={() =>
                setScope({
                  type: 'Person',
                  key: row.subject_key,
                  label: row.full_name || 'New person',
                })
              }
            />
          ))}
        </div>
      </aside>

      <main className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {person
                ? person.full_name
                : scope.type === 'Department'
                  ? `${scope.label} Department`
                  : 'All selected people'}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {person
                ? `${person.department || 'No Department'} · ${person.devices.length} Devices · ${person.current_services.length} current services`
                : `${scoped.length} people · actions may apply to all or only part of this ${
                    scope.type === 'Department' ? 'group' : 'selection'
                  }.`}
            </p>
          </div>

          {!person && (
            <button
              type="button"
              onClick={() => setReading(true)}
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100"
            >
              View people
            </button>
          )}
        </div>

        <div className="px-5 py-4">
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
            <Info size={14} className="mt-0.5 shrink-0 text-slate-400" />
            <div>
              <p className="text-[11px] font-semibold text-slate-900">
                Group actions stay explicit
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                An action appears when at least one target can use it. You review the exact
                impact before adding it; other targets remain unchanged.
              </p>
            </div>
          </div>

          {operations.isLoading && (
            <p className="py-8 text-center text-sm text-slate-500">Reading what can be asked…</p>
          )}

          {domains.map((domain) =>
            domain.key === 'Service' ? (
              <section key={domain.key} className="mb-5">
                <div className="mb-2 flex items-baseline justify-between">
                  <p className="text-xs font-semibold text-slate-900">{domain.label}</p>
                  <span className="text-[10px] text-slate-500">Current + requestable</span>
                </div>

                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full">
                    <thead className="bg-slate-50">
                      <tr>
                        <Th>Service</Th>
                        <Th>Coverage</Th>
                        <Th align="right">Available actions</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {domain.options.map((card) => (
                        <tr key={card.object_key}>
                          <td className="px-3 py-2.5 align-middle">
                            <p className="text-sm font-semibold text-slate-900">
                              {card.object_label}
                            </p>
                            <p className="mt-0.5 text-[10px] text-slate-500">MSP service</p>
                          </td>
                          <td className="px-3 py-2.5 align-middle">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-semibold text-slate-900">
                                {card.current_count} current · {card.without_count} without
                              </p>
                              <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">
                                {card.service_scope}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[10px] text-slate-500">
                              {card.current_count} active
                            </p>
                          </td>
                          <td className="px-3 py-2.5 align-middle">
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              {card.actions.map((action) => {
                                const here = askedHere(
                                  action.targets,
                                  action.operation_code,
                                  card.object_key
                                );
                                const left = action.targets.length - here;
                                const all = here > 0 && left === 0;
                                const shut = action.blocked_reason ?? null;

                                return (
                                  <React.Fragment key={action.operation_code}>
                                    {here > 0 && (
                                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                        {all ? 'Asked' : `${here} asked`}
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      disabled={all || Boolean(shut)}
                                      title={
                                        shut ??
                                        (all ? 'Already asked for in this request' : undefined)
                                      }
                                      onClick={() => setService({ option: action, card })}
                                      className={`${
                                        action.operation_code === 'service.add'
                                          ? quickPrimary
                                          : quickBtn
                                      } disabled:cursor-not-allowed disabled:opacity-40`}
                                    >
                                      {action.operation_label}
                                      {shut ? '' : ` · ${all ? action.applicable_target_count : left}`}
                                    </button>
                                  </React.Fragment>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : (
              <section key={domain.key} className="mb-5">
                <div className="mb-2 flex items-baseline justify-between">
                  <p className="text-xs font-semibold text-slate-900">{domain.label}</p>
                  <span className="text-[10px] text-slate-500">Real Device state</span>
                </div>

                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full">
                    <thead className="bg-slate-50">
                      <tr>
                        <Th>Operation</Th>
                        <Th>Scope</Th>
                        <Th align="right">Action</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {domain.options.map((option) => (
                        <tr key={option.operation_code}>
                          <td className="px-3 py-2.5 align-middle">
                            <p className="text-sm font-semibold text-slate-900">
                              {option.operation_label}
                            </p>
                            <p className="mt-0.5 text-[10px] text-slate-500">
                              {option.operation_code === 'device.transfer'
                                ? 'Transfer current Devices to another holder'
                                : option.operation_code === 'device.assign'
                                  ? 'Give a Device: one on file, a new one, or our choice'
                                  : 'Take current Devices back into stock'}
                            </p>
                          </td>
                          <td className="px-3 py-2.5 align-middle">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-semibold text-slate-900">
                                {option.operation_code === 'device.assign'
                                  ? `${option.without_device_count ?? 0} without a Device`
                                  : `${option.device_count} Device(s)`}
                              </p>
                              <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">
                                {option.applicable_subject_count} people
                              </span>
                            </div>
                            <p className="mt-0.5 text-[10px] text-slate-500">
                              Only what you configure creates request lines
                            </p>
                          </td>
                          <td className="px-3 py-2.5 align-middle">
                            <div className="flex items-center justify-end gap-1.5">
                              {askedHere(option.targets, option.operation_code) > 0 && (
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                  {askedHere(option.targets, option.operation_code)} asked
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => setDevice(option)}
                                className={
                                  option.operation_code === 'device.transfer' ||
                                  option.operation_code === 'device.assign'
                                    ? quickPrimary
                                    : quickBtn
                                }
                              >
                                {option.operation_code === 'device.transfer'
                                  ? 'Configure transfers'
                                  : option.operation_code === 'device.assign'
                                    ? 'Ask for a Device'
                                    : 'Review Devices'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          )}

          {!operations.isLoading && domains.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500">
              No action is available for this scope.
            </p>
          )}
        </div>

        <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Requested actions
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {builder.actionGroups.map((group) => (
              <span
                key={group.groupKey}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-700"
              >
                <strong className="font-semibold text-blue-700">
                  {group.operationLabelSnapshot}
                </strong>
                · {group.targets.length} target{group.targets.length === 1 ? '' : 's'} ·{' '}
                {group.sourceScopeLabel}
                {group.sourceScopeType === 'All' &&
                  group.selectedSubjectCount !== builder.subjects.length && (
                    <span
                      title={`Configured for ${group.selectedSubjectCount} people; the request now holds ${builder.subjects.length}. Add it again to reach the others.`}
                      className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800"
                    >
                      people changed
                    </span>
                  )}
                <button
                  type="button"
                  aria-label={`Remove ${group.operationLabelSnapshot}`}
                  onClick={() => builder.removeActionGroup(group.groupKey)}
                  className="text-red-600 transition-colors hover:text-red-700"
                >
                  <X size={12} />
                </button>
              </span>
            ))}

            {builder.actionGroups.length === 0 && (
              <span className="text-[11px] text-slate-500">No action added yet.</span>
            )}
          </div>
        </div>
      </main>

      {reading && <ScopePeople rows={scoped} onClose={() => setReading(false)} />}

      {service && (
        <ServiceImpact
          option={service.option}
          scope={scope}
          serviceItem={service.card.object_label}
          selectedSubjectCount={scoped.length}
          asked={askedFrom(alreadyAsked, service.option.operation_code, service.card.object_key)}
          onClose={() => setService(null)}
          onAdd={(targets, exclusions) =>
            add(service.option, targets, exclusions, 'Service', service.card.object_key)
          }
        />
      )}

      {device &&
        (device.operation_code === 'device.transfer' ? (
          <Transfers
            option={device}
            onClose={() => setDevice(null)}
            onAdd={(targets) => add(device, targets, device.exclusions, 'Device')}
          />
        ) : device.operation_code === 'device.assign' ? (
          <AssignDevice
            option={device}
            onClose={() => setDevice(null)}
            onAdd={(targets) => add(device, targets, device.exclusions, 'Device')}
          />
        ) : (
          <ReturnToStock
            option={device}
            onClose={() => setDevice(null)}
            onAdd={(targets) => add(device, targets, device.exclusions, 'Device')}
          />
        ))}
    </div>
  );
};

export default RequestActionsStep;
