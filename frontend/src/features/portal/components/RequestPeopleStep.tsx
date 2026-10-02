import React, { useState } from 'react';
import { Building2, Laptop, Layers, Plus, UserPlus, X } from 'lucide-react';
import FieldLabel from '@/shared/components/FieldLabel';
import Modal from '@/shared/components/Modal';
import Select from '@/shared/components/Select';
import TruncatedNote from '@/shared/components/TruncatedNote';
import type { RequestSubjectRow } from '@/lib/api/portal';
import {
  useCompanySelection,
  useDepartmentSelection,
  useNewPersonContext,
  usePortalFilterOptions,
  useRequestScope,
  useSelectableClientUsers,
  useSelectableDevices,
} from '../hooks/usePortal';
import RequestNewDeviceModal from './RequestNewDeviceModal';
import RequestNewPersonModal from './RequestNewPersonModal';
import type { useRequestBuilder } from '../hooks/useRequestBuilder';

type Builder = ReturnType<typeof useRequestBuilder>;

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : '—');

const actionBtn =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50';
const quietBtn =
  'rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50';
const primaryBtn =
  'rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60';
const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const Th: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <th className="whitespace-nowrap px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
    {children}
  </th>
);

/** Several values in one cell, without letting the row run off the page. */
const Tokens: React.FC<{ values: string[] }> = ({ values }) => {
  if (!values.length) return <span className="text-slate-400">—</span>;

  const all = values.join(', ');

  return (
    <span className="inline-flex items-center gap-1">
      <span
        title={all}
        className="inline-block max-w-[9.5rem] truncate rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700"
      >
        {values[0]}
      </span>
      {values.length > 1 && (
        <span
          title={all}
          className="inline-block rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700"
        >
          + {values.length - 1} more
        </span>
      )}
    </span>
  );
};

const SelectExisting: React.FC<{ builder: Builder; onClose: () => void }> = ({
  builder,
  onClose,
}) => {
  const [search, setSearch] = useState('');
  const results = useSelectableClientUsers(search || undefined);
  const chosen = new Set(builder.subjects.map((subject) => subject.clientUser));
  const rows = (results.data?.rows ?? []).filter((person) => !chosen.has(person.name));

  return (
    <Modal
      open
      onClose={onClose}
      icon={UserPlus}
      title="Select existing user"
      subtitle="Search existing Client Users."
      widthClass="max-w-2xl"
      footer={
        <div className="flex items-center justify-end">
          <button type="button" onClick={onClose} className={primaryBtn}>
            Done
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <FieldLabel>Search</FieldLabel>
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search"
            placeholder="Name, email or Department"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>

        <div className="max-h-80 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200">
          {rows.map((person) => (
            <div
              key={person.name}
              data-person={person.name}
              aria-disabled={!person.selectable || undefined}
              title={person.selectable ? undefined : (person.disabled_reason ?? undefined)}
              className={`flex items-center justify-between gap-3 px-3 py-2 ${
                person.selectable ? '' : 'bg-slate-50/70'
              }`}
            >
              <div className="min-w-0">
                <p
                  className={`truncate text-sm font-semibold ${
                    person.selectable ? 'text-slate-900' : 'text-slate-400'
                  }`}
                >
                  {person.full_name}
                  {!person.selectable && (
                    <span className="ml-1.5 text-[11px] font-medium">{person.lifecycle_status}</span>
                  )}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {person.selectable
                    ? [person.email, person.department].filter(Boolean).join(' · ') ||
                      'No Department'
                    : person.disabled_reason}
                </p>
              </div>
              <button
                type="button"
                disabled={!person.selectable}
                aria-label={`Add ${person.full_name}`}
                onClick={() => builder.addExistingSubject(person)}
                className={`${actionBtn} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                Add
              </button>
            </div>
          ))}

          {rows.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-slate-500">No result.</p>
          )}
        </div>
        <TruncatedNote page={results.data} />
      </div>
    </Modal>
  );
};

/**
 * A request raised about a machine.
 *
 * Whose machine it is decides what the request is about. One somebody holds belongs to that
 * person, so they are the subject and the machine is simply one of the things they have —
 * exactly as if they had been picked by name. One nobody holds belongs to nobody, so it
 * stands in the table in its own right.
 */
const SelectDevice: React.FC<{ builder: Builder; onClose: () => void }> = ({ builder, onClose }) => {
  const [search, setSearch] = useState('');
  const [describing, setDescribing] = useState(false);
  const results = useSelectableDevices(search || undefined);
  const options = usePortalFilterOptions();
  const rows = results.data?.rows ?? [];

  const taken = new Set(
    builder.subjects.flatMap((subject) => (subject.managedDevice ? [subject.managedDevice] : []))
  );
  const held = new Set(builder.subjects.flatMap((subject) => (subject.clientUser ? [subject.clientUser] : [])));

  const add = (device: (typeof rows)[number]) => {
    if (device.current_holder) {
      builder.addExistingSubject({
        name: device.current_holder,
        full_name: device.current_holder_name || device.current_holder,
      });

      return;
    }

    builder.addDeviceSubject({
      name: device.name,
      label: device.hostname || device.serial_number || 'Free device',
    });
  };

  const already = (device: (typeof rows)[number]) =>
    device.current_holder ? held.has(device.current_holder) : taken.has(device.name);

  if (describing) {
    return (
      <RequestNewDeviceModal
        deviceTypes={options.data?.device_types ?? []}
        futurePeople={builder.subjects
          .filter((subject) => subject.kind === 'new')
          .map((subject) => ({ key: subject.key, fullName: subject.fullName || 'New person' }))}
        onClose={() => setDescribing(false)}
        onAdd={(device, holder) => {
          // a machine described for somebody is the request we already know how to make:
          // the builder puts that person in the table and raises Assign Device on them
          if (device.intended_holder_client_user || device.intended_holder_subject_key) {
            builder.addActionGroup(null, [device], { holders: holder ? [holder] : [] });
          } else {
            builder.addDeviceSubject(
              {
                label: device.display_label,
                deviceRequirementKey: device.device_requirement_key,
              },
              device
            );
          }

          setDescribing(false);
          onClose();
        }}
      />
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      icon={Laptop}
      title="Select Device"
      subtitle="Pick a Device of this Customer, or describe one it does not have yet."
      widthClass="max-w-2xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setDescribing(true)} className={actionBtn}>
            <Plus size={13} />
            New device
          </button>
          <button type="button" onClick={onClose} className={primaryBtn}>
            Done
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <FieldLabel>Search</FieldLabel>
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search"
            placeholder="Hostname, serial or holder"
            className={inputClass}
          />
        </div>

        <div className="max-h-80 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200">
          {rows.map((device) => (
            <div
              key={device.name}
              data-device={device.name}
              aria-disabled={!device.selectable || undefined}
              title={device.selectable ? undefined : (device.unavailable_reason ?? undefined)}
              className={`flex items-center justify-between gap-3 px-3 py-2 ${
                device.selectable ? '' : 'bg-slate-50/70'
              }`}
            >
              <div className="min-w-0">
                <p
                  className={`truncate text-sm font-semibold ${
                    device.selectable ? 'text-slate-900' : 'text-slate-400'
                  }`}
                >
                  {device.hostname || device.serial_number || 'Free device'}
                  <span className="ml-1.5 text-[11px] font-medium text-slate-400">{device.status}</span>
                </p>
                <p className="truncate text-xs text-slate-500">
                  {device.selectable
                    ? [
                        device.device_type,
                        device.serial_number,
                        device.current_holder_name
                          ? `Held by ${device.current_holder_name}`
                          : 'Nobody holds it',
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : device.unavailable_reason}
                </p>
              </div>
              <button
                type="button"
                disabled={!device.selectable || already(device)}
                aria-label={`Add ${device.hostname || device.name}`}
                title={
                  already(device)
                    ? device.current_holder
                      ? 'Its holder is already in this request'
                      : 'Already in this request'
                    : undefined
                }
                onClick={() => add(device)}
                className={`${actionBtn} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {already(device) ? 'Added' : 'Add'}
              </button>
            </div>
          ))}

          {rows.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-slate-500">No result.</p>
          )}
        </div>
        <TruncatedNote page={results.data} />
      </div>
    </Modal>
  );
};

const AddDepartment: React.FC<{ builder: Builder; onClose: () => void }> = ({
  builder,
  onClose,
}) => {
  const context = useNewPersonContext();
  const [department, setDepartment] = useState('');
  const selection = useDepartmentSelection(department || undefined);
  const people = selection.data?.people ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      icon={Layers}
      title="Add a Department"
      subtitle="Load active Client Users from this Department into the same table."
      widthClass="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={quietBtn}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!department || selection.isLoading || people.length === 0}
            onClick={() => {
              if (!selection.data) return;

              builder.addGroupSubjects(selection.data.people, {
                selectionOrigin: selection.data.selection_origin,
                selectionGroupKey: selection.data.selection_group_key,
                selectionLabel: selection.data.selection_label,
                selectionSnapshotAt: selection.data.selection_snapshot_at,
              });
              onClose();
            }}
            className={primaryBtn}
          >
            Load Department
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <FieldLabel required>Department</FieldLabel>
          <Select
            searchable
            className="w-full"
            value={department}
            onChange={setDepartment}
            placeholder="Select department"
            options={(context.data?.departments ?? []).map((row) => ({
              value: row.value,
              label: row.label,
            }))}
          />
        </div>

        <p className="text-xs text-slate-500">Disabled or archived Client Users are excluded.</p>

        {department && !selection.isLoading && people.length === 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-sm text-amber-900">
            No active Client User from this Customer is currently in this Department.
          </p>
        )}

        {people.length > 0 && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
            {people.length} active people will be added.
          </p>
        )}
      </div>
    </Modal>
  );
};

const AddCompany: React.FC<{ builder: Builder; onClose: () => void }> = ({ builder, onClose }) => {
  const selection = useCompanySelection(true);
  const people = selection.data?.people ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      icon={Building2}
      title="Add entire company"
      subtitle="Load all active Client Users currently managed for this Customer."
      widthClass="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={quietBtn}>
            Cancel
          </button>
          <button
            type="button"
            disabled={selection.isLoading || people.length === 0}
            onClick={() => {
              if (!selection.data) return;

              builder.addGroupSubjects(selection.data.people, {
                selectionOrigin: selection.data.selection_origin,
                selectionGroupKey: selection.data.selection_group_key,
                selectionLabel: selection.data.selection_label,
                selectionSnapshotAt: selection.data.selection_snapshot_at,
              });
              onClose();
            }}
            className={primaryBtn}
          >
            Add entire company
          </button>
        </div>
      }
    >
      <div className="space-y-2">
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
          {people.length} active people will be added.
        </p>
        <p className="text-xs text-slate-500">
          The selection becomes a fixed snapshot. People created later are not added
          automatically.
        </p>
      </div>
    </Modal>
  );
};

/**
 * Who the request is for, however they were chosen.
 *
 * Four doors, one table: picking somebody by hand, entering somebody who does not exist yet,
 * loading a Department or the whole company all append rows here. Nothing about a person is
 * worked out in the browser — the row is what the server says they hold and run today.
 */
const RequestPeopleStep: React.FC<{ builder: Builder }> = ({ builder }) => {
  const [opened, setOpened] = useState<
    'existing' | 'new' | 'device' | 'department' | 'company' | null
  >(null);
  const scope = useRequestScope(builder.subjectDrafts);
  const rows = scope.data?.subjects ?? [];
  const byKey = new Map(rows.map((row) => [row.subject_key, row]));
  const departments = [
    ...new Set(rows.map((row) => row.department).filter(Boolean) as string[]),
  ];
  const fresh = builder.subjects.filter((subject) => subject.kind === 'new').length;

  const cell = (subject: (typeof builder.subjects)[number]): RequestSubjectRow =>
    byKey.get(subject.key) ?? {
      subject_key: subject.key,
      kind: subject.kind,
      client_user: subject.clientUser ?? null,
      requested_client_user: subject.requestedClientUser ?? null,
      full_name: subject.fullName ?? '',
      department: subject.department ?? null,
      email: subject.email ?? null,
      username: subject.username ?? null,
      added_via: subject.kind === 'new' ? 'New' : 'Existing',
      selection_label: null,
      devices: [],
      current_services: [],
      last_billed: null,
      usable: true,
      reason_code: null,
    };

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">People</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Every selection method feeds the same table.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setOpened('existing')} className={actionBtn}>
            <Plus size={13} />
            Existing user
          </button>
          <button type="button" onClick={() => setOpened('device')} className={actionBtn}>
            <Laptop size={13} />
            Select Device
          </button>
          <button type="button" onClick={() => setOpened('new')} className={actionBtn}>
            <UserPlus size={13} />
            New user
          </button>
          <button type="button" onClick={() => setOpened('department')} className={actionBtn}>
            <Layers size={13} />
            Department
          </button>
          <button
            type="button"
            onClick={() => setOpened('company')}
            className={`${actionBtn} border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100`}
          >
            <Building2 size={13} />
            Entire company
          </button>
        </div>
      </div>

      {builder.subjects.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-5 pt-3">
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
            {builder.subjects.length} people
          </span>
          {departments.map((department) => (
            <span
              key={department}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600"
            >
              {department} · {rows.filter((row) => row.department === department).length}
            </span>
          ))}
          {fresh > 0 && (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
              {fresh} new
            </span>
          )}
        </div>
      )}

      <div className="m-5 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <Th>Person</Th>
              <Th>Last billed</Th>
              <Th>Devices</Th>
              <Th>Current services</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {builder.subjects.map((subject) => {
              const row = cell(subject);

              return (
                <tr key={subject.key} className="align-middle">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-slate-900">
                        {row.full_name || 'New person'}
                      </span>
                      {row.kind === 'new' && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                          NEW
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {row.department || 'No Department'} · {row.email || 'No email'}
                    </p>
                  </td>
                  <td
                    className="px-4 py-2.5 text-sm text-slate-600"
                    title="Latest posted billing coverage for this person's User-scoped services. Device services are not included."
                  >
                    {row.last_billed ? fmtDate(row.last_billed) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-sm">
                    <Tokens values={row.devices.map((device) => device.label)} />
                  </td>
                  <td className="px-4 py-2.5 text-sm">
                    <Tokens
                      values={row.current_services.map((service) =>
                        service.status === 'Active'
                          ? service.label
                          : `${service.label} (${service.status})`
                      )}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      aria-label={`Remove ${row.full_name}`}
                      onClick={() => builder.removeSubject(subject.key)}
                      className="rounded-lg border border-slate-200 p-1.5 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                    >
                      <X size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}

            {builder.subjects.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                  Add people to start the request.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {opened === 'existing' && (
        <SelectExisting builder={builder} onClose={() => setOpened(null)} />
      )}
      {opened === 'device' && <SelectDevice builder={builder} onClose={() => setOpened(null)} />}
      {opened === 'new' && (
        <RequestNewPersonModal
          onClose={() => setOpened(null)}
          onAdd={(values) => builder.addNewSubject(values)}
        />
      )}
      {opened === 'department' && (
        <AddDepartment builder={builder} onClose={() => setOpened(null)} />
      )}
      {opened === 'company' && <AddCompany builder={builder} onClose={() => setOpened(null)} />}
    </section>
  );
};

export default RequestPeopleStep;
