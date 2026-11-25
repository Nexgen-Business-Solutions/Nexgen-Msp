import React from 'react';
import { useNotificationSources } from './useNotifications';
import { Satellite } from 'lucide-react';
import { InfoStrip, Message, Pill, SkeletonRows, rowClass, thClass } from './ui';
import { fmtMoment } from './format';

const isManaged = (management: string) => /^msp/i.test(management) && !/external|read/i.test(management);

const SourcesTab: React.FC<{ active: boolean }> = ({ active }) => {
  const sources = useNotificationSources(active);
  const rows = sources.data?.rows ?? [];

  return (
    <div>
      <InfoStrip>
        Notifications owned by this application can be managed here. Sources that belong to Frappe,
        ERPNext or other apps are shown for reference and are never changed from this screen.
      </InfoStrip>

      {sources.isLoading ? (
        <SkeletonRows />
      ) : sources.isError ? (
        <Message tone="error" title="The source inventory could not be loaded">
          {sources.error instanceof Error ? sources.error.message : undefined}
        </Message>
      ) : rows.length === 0 ? (
        <Message icon={Satellite} title="No notification sources were found" />
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left">
            <thead>
              <tr>
                {['Source', 'Provider', 'Trigger mode', 'Management', 'Notes'].map((head, index) => (
                  <th key={head} scope="col" className={`${thClass} ${index === 0 ? 'pl-5 pr-4 sm:pl-6' : 'px-4'}`}>
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={`${row.provider}-${row.source}`} className={`align-top ${rowClass}`}>
                  <td className="py-3 pl-5 pr-4 text-sm font-semibold text-slate-900 sm:pl-6">{row.source}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.provider}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.trigger_mode}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Pill tone={isManaged(row.management) ? 'blue' : 'slate'}>{row.management}</Pill>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">{row.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sources.data?.generated_at && (
        <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500 sm:px-6">
          Inventory generated {fmtMoment(sources.data.generated_at)}
        </p>
      )}
    </div>
  );
};

export default SourcesTab;
