import React, { useEffect, useState } from 'react';
import { AlertCircle, CircleCheck } from 'lucide-react';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import { usePortalSettings, useSavePortalSettings } from '../hooks/useSettings';

const SITE_DEFAULT = '';

/** One block of settings: what it is on the left, its fields on the right. */
const Group = ({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) => (
  <div className="grid grid-cols-1 gap-x-8 gap-y-4 px-5 py-6 sm:px-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
    <div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-0.5 text-sm text-slate-500">{description}</p>
    </div>
    <div className="min-w-0">{children}</div>
  </div>
);


const PortalSettingsForm: React.FC = () => {
  const settings = usePortalSettings();
  const save = useSavePortalSettings();

  const [portalUrl, setPortalUrl] = useState('');
  const [timeout, setTimeout_] = useState(SITE_DEFAULT);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    setPortalUrl(settings.data.portal_url || '');
    setTimeout_(settings.data.customer_session_timeout || SITE_DEFAULT);
    setDirty(false);
  }, [settings.data]);

  const submit = async () => {
    try {
      await save.mutateAsync({ portal_url: portalUrl, customer_session_timeout: timeout });
      setDirty(false);
    } catch {
      // surfaced below
    }
  };

  if (settings.isLoading) {
    return <p className="px-5 py-12 text-center text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="divide-y divide-slate-100">
      <Group
        title="Address"
        description="Where customers reach the portal, and where emailed links point."
      >
        <div className="grid grid-cols-1 gap-4">
          <div>
            <FieldLabel>Portal address</FieldLabel>
            <input
              type="text"
              value={portalUrl}
              onChange={(event) => {
                setPortalUrl(event.target.value);
                setDirty(true);
              }}
              placeholder="https://portal.example.com"
              className="h-10 w-full rounded-md border-0 bg-slate-100/80 px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              The address customers use. Every link we email them points here; left empty, the
              links use the internal address. Nobody is ever redirected between the two.
            </p>
          </div>
        </div>
      </Group>

      <Group
        title="Sessions"
        description="How long a customer stays signed in."
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
          <div>
            <FieldLabel>Customer session timeout</FieldLabel>
            <Select
              className="w-full"
              value={timeout}
              onChange={(value) => {
                setTimeout_(value);
                setDirty(true);
              }}
              placeholder="Same as the site"
              options={[
                { value: SITE_DEFAULT, label: 'Same as the site' },
                ...(settings.data?.timeout_options ?? []).map((option) => ({
                  value: option,
                  label: option,
                })),
              ]}
            />
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              How long a customer account may stay signed in without activity before it is
              asked to sign in again. Internal accounts follow the site setting.
            </p>
          </div>
        </div>
      </Group>

      {save.error instanceof Error && (
        <div className="px-5 py-4 sm:px-6">
          <div className="flex items-start gap-2.5 rounded-2xl bg-red-50 p-3.5 ring-1 ring-red-200">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{save.error.message}</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 rounded-b-2xl bg-slate-50/60 px-5 py-4 sm:px-6">
        {!dirty && save.isSuccess && (
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
            <CircleCheck size={15} />
            Saved
          </span>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!dirty || save.isLoading}
          className="flex min-w-[7rem] items-center justify-center rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {save.isLoading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            'Save'
          )}
        </button>
      </div>
    </div>
  );
};

export default PortalSettingsForm;
