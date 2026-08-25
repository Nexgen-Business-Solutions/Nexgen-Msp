import { useNavigate } from 'react-router-dom';
import { AlertCircle, Copy, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import Select from '@/shared/components/Select';
import ServiceStateHint from '../components/ServiceStateHint';
import { NEW_DEVICE, useServiceRequestForm } from '../hooks/useServiceRequestForm';
import { useSession } from '@/shared/hooks/useSession';
import { isPortalOnly } from '@/shared/layout/navigation';
import { useUserFilterOptions } from '@/features/internal/hooks/useUsers';
import { usePortalFilters } from '../store/usePortalFilters';

const labelClass = 'mb-1.5 block text-xs font-semibold text-slate-700';
const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

export default function NewServiceRequest() {
  const navigate = useNavigate();
  const form = useServiceRequestForm(() => navigate('/msp'));

  // staff serve every customer, so they must say who they are acting for; a contact
  // has only their own and never sees this
  const { data: session } = useSession();
  const onBehalf = !isPortalOnly(session?.roles);
  const customer = usePortalFilters((state) => state.customer);
  const setCustomer = usePortalFilters((state) => state.setCustomer);
  const options = useUserFilterOptions();

  if (onBehalf && !customer) {
    return (
      <div className="px-6 pb-6 pt-4">
        <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Who is this request for?</h2>
          <p className="mt-1 text-sm text-slate-500">
            Pick the customer you are raising it on behalf of. Only what their contract covers
            can be requested.
          </p>
          <div className="mt-4 sm:max-w-sm">
            <Select
              searchable
              className="w-full"
              value=""
              onChange={setCustomer}
              placeholder="Pick a customer"
              options={(options.data?.customers ?? []).map((value) => ({ value, label: value }))}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 pb-6 pt-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.submit();
        }}
        className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm"
      >
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Services request</h2>
              <p className="mt-1 text-sm text-slate-500">
                Create your request and set descrition of what you need for each case.
              </p>
              {onBehalf && customer && (
                <p className="mt-2 inline-flex items-center gap-2 text-sm text-slate-600">
                  On behalf of <span className="font-semibold text-slate-900">{customer}</span>
                  <button
                    type="button"
                    onClick={() => setCustomer(null)}
                    className="font-medium text-blue-600 transition-colors hover:text-blue-700"
                  >
                    change
                  </button>
                </p>
              )}
            </div>

            <div className="w-full sm:w-48">
              <span className={labelClass}>Priority</span>
              <Select
                className="w-full"
                value={form.priority}
                onChange={form.setPriority}
                options={form.options.priorities}
              />
            </div>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5">
          {form.lines.map((line, index) => {
            const errors = form.errors[index];
            const showErrors = form.touched;
            return (
              <div
                key={line.key}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-200 text-xs font-bold text-slate-600 tabular-nums">
                      {index + 1}
                    </span>

                    {line.services.length > 0 && (
                      <span className="hidden text-xs font-medium text-slate-500 sm:inline">
                        {line.services.length} service{line.services.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => form.duplicateLine(line.key)}
                      aria-label="Duplicate block"
                      title="Duplicate block"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white hover:text-slate-600"
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      type="button"
                      disabled={form.lines.length <= 1}
                      onClick={() => form.removeLine(line.key)}
                      aria-label="Remove block"
                      title="Remove block"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <div className="space-y-4 p-4">
                  <div className="inline-flex rounded-lg bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => form.updateLine(line.key, 'isNewUser', false)}
                      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2.5 text-xs font-semibold transition-all ${line.isNewUser
                          ? 'text-slate-500 hover:text-slate-700'
                          : 'bg-white text-slate-900 shadow-sm'
                        }`}
                    >
                      <Users size={13} />
                      Existing user
                    </button>
                    <button
                      type="button"
                      onClick={() => form.updateLine(line.key, 'isNewUser', true)}
                      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${line.isNewUser
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                      <UserPlus size={13} />
                      New user
                    </button>
                  </div>

                  {line.isNewUser ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <span className={labelClass}>Full name</span>
                        <input
                          type="text"
                          value={line.new_user_full_name}
                          onChange={(event) =>
                            form.updateLine(line.key, 'new_user_full_name', event.target.value)
                          }
                          placeholder="Marie Dupont"
                          className={inputClass}
                        />
                        {showErrors && errors.new_user_full_name && (
                          <p className="mt-1 text-xs text-red-600">{errors.new_user_full_name}</p>
                        )}
                      </div>
                      <div>
                        <span className={labelClass}>Department</span>
                        <input
                          type="text"
                          value={line.new_user_department}
                          onChange={(event) =>
                            form.updateLine(line.key, 'new_user_department', event.target.value)
                          }
                          placeholder="Accounting"
                          className={inputClass}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="sm:w-2/3">
                      <span className={labelClass}>User</span>
                      <Select
                        className="w-full"
                        value={line.client_user}
                        onChange={(value) => form.updateLine(line.key, 'client_user', value)}
                        placeholder="Select a user"
                        options={form.options.users}
                      />
                      {showErrors && errors.client_user && (
                        <p className="mt-1 text-xs text-red-600">{errors.client_user}</p>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div >
                      <span className={labelClass}>Service</span>
                      <Select
                        className="w-full"
                        searchable
                        value={line.services[0] ?? ''}
                        onChange={(value) => form.updateLine(line.key, 'services', value ? [value] : [])}
                        options={form.options.services}
                        placeholder="Select a service"
                      />
                      {showErrors && errors.services && (
                        <p className="mt-1 text-xs text-red-600">{errors.services}</p>
                      )}
                      {!line.isNewUser && (
                        <ServiceStateHint
                          serviceItem={line.services[0]}
                          clientUser={line.client_user || undefined}
                          managedDevice={
                            line.managed_device && line.managed_device !== NEW_DEVICE
                              ? line.managed_device
                              : undefined
                          }
                        />
                      )}
                    </div>
                    <div >
                      <span className={labelClass}>Action</span>
                      <Select
                        className="w-full"
                        // label="Action"
                        searchable
                        value={line.action}
                        placeholder="Choose an action"
                        onChange={(value) => form.updateLine(line.key, 'action', value)}
                        options={
                          line.isNewUser ? form.options.actionsForNewUser : form.options.actions
                        }
                      />
                      {showErrors && errors.action && (
                        <p className="mt-1 text-xs text-red-600">{errors.action}</p>
                      )}
                    </div>
                    <div>
                      <span className={labelClass}>Wanted modification date</span>
                      <input
                        type="date"
                        value={line.requested_effective_date}
                        onChange={(event) =>
                          form.updateLine(line.key, 'requested_effective_date', event.target.value)
                        }
                        className={inputClass}
                      />
                    </div>
                  </div>

                  {line.services.some((service) => form.deviceServices.has(service)) && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div className="sm:col-span-2">
                        <span className={labelClass}>Device concerned</span>
                        <Select
                          className="w-full"
                          value={line.managed_device}
                          onChange={(value) => form.updateLine(line.key, 'managed_device', value)}
                          placeholder="Select the device"
                          options={[
                            ...(line.isNewUser || !line.client_user
                              ? []
                              : form.devicesFor(line.client_user)),
                            {
                              value: form.newDeviceValue,
                              label: 'Not registered yet',
                              description: 'Ask us to register a new machine',
                            },
                          ]}
                        />
                        {showErrors && errors.managed_device && (
                          <p className="mt-1 text-xs text-red-600">{errors.managed_device}</p>
                        )}
                      </div>

                      {line.managed_device === form.newDeviceValue && (
                        <div>
                          <span className={labelClass}>Which device?</span>
                          <input
                            type="text"
                            value={line.new_device_label}
                            onChange={(event) =>
                              form.updateLine(line.key, 'new_device_label', event.target.value)
                            }
                            placeholder="New Dell laptop, delivered Monday"
                            className={inputClass}
                          />
                          {showErrors && errors.new_device_label && (
                            <p className="mt-1 text-xs text-red-600">{errors.new_device_label}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <span className={labelClass}>Comment</span>
                    <textarea
                      rows={5}
                      value={line.comment}
                      onChange={(event) => form.updateLine(line.key, 'comment', event.target.value)}
                      placeholder="Any detail we should know: replacement, temporary access, specific configuration…"
                      className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm leading-relaxed text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    />
                  </div>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={form.addLine}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-3 text-sm font-medium text-slate-500 transition-colors hover:border-blue-400 hover:bg-blue-50/40 hover:text-blue-600"
          >
            <Plus size={16} />
            Add another need
          </button>
        </div>

        {form.submitError instanceof Error && (
          <div className="mx-6 mb-4 flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3 text-red-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span className="text-sm font-medium">{form.submitError.message}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <span className="text-xs text-slate-500">
            {form.lines.length} block{form.lines.length > 1 ? 's' : ''} ·{' '}
            <span className="font-semibold text-slate-700 tabular-nums">
              {form.totalServices}
            </span>{' '}
            service{form.totalServices > 1 ? 's' : ''} requested
          </span>

          <div className="flex items-center gap-2">
            {/* <button
              type="button"
              onClick={form.reset}
              disabled={form.submitting}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              Reset
            </button> */}
            <button
              type="submit"
              disabled={form.submitting || form.loadingOptions}
              className="flex min-w-[9rem] items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {form.submitting ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                'Submit request'
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
