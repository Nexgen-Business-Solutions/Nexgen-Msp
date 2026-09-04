import React, { useEffect, useState } from 'react';
import { AlertCircle, CircleCheck } from 'lucide-react';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import { usePortalSettings, useSavePortalSettings } from '../hooks/useSettings';

const SITE_DEFAULT = '';

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
    <div className="space-y-6 px-5 pb-5">
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Address
        </p>
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
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            />
            <p className="mt-1.5 text-sm text-slate-500">
              The address customers use. Every link we email them points here; left empty, the
              links use the internal address. Nobody is ever redirected between the two.
            </p>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Sessions
        </p>
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
            <p className="mt-1.5 text-sm text-slate-500">
              How long a customer account may stay signed in without activity before it is
              asked to sign in again. Internal accounts follow the site setting.
            </p>
          </div>
        </div>
      </div>

      {save.error instanceof Error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
          <span className="text-sm font-medium text-red-700">{save.error.message}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
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
          className="flex min-w-[7rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
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
