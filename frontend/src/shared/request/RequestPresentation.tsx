import type { ReactNode } from 'react';
import { ListChecks, Sparkles, Target, Users, type LucideIcon } from 'lucide-react';
import type {
  RequestActionGroupPresentation,
  RequestPresentation as Presentation,
  RequestPresentationMode,
  RequestSubjectPresentation,
  RequestTargetPresentation,
} from './types';
import RequestPresentationHeader from './RequestPresentationHeader';
import RequestPeopleSummary from './RequestPeopleSummary';
import RequestActionGroupList from './RequestActionGroupList';
import RequestedEntitiesSummary from './RequestedEntitiesSummary';
import RequestInformationPanel from './RequestInformationPanel';
import RequestAttentionPanel from './RequestAttentionPanel';
import FulfilmentOutcomeSummary from './FulfilmentOutcomeSummary';
import RequestRejection from './RequestRejection';

type Props = {
  presentation: Presentation;
  mode: RequestPresentationMode;
  withHeader?: boolean;
  headerActions?: ReactNode;
  notice?: ReactNode;
  approvalBar?: ReactNode;
  footer?: ReactNode;
  renderGroupControls?: (group: RequestActionGroupPresentation) => ReactNode;
  renderTargetControls?: (target: RequestTargetPresentation, group: RequestActionGroupPresentation) => ReactNode;
  renderPersonDetail?: (subject: RequestSubjectPresentation) => ReactNode;
  onViewExecutionRecap?: () => void;
};

const Summary = ({
  icon: Icon,
  tile,
  label,
  value,
}: {
  icon: LucideIcon;
  tile: string;
  label: string;
  value: number;
}) => (
  <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3.5 shadow-sm ring-1 ring-slate-200/70">
    <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-xl ring-1 ${tile}`}>
      <Icon className="size-5" strokeWidth={1.75} />
    </span>
    <div className="min-w-0">
      <p className="text-2xl font-bold leading-tight tabular-nums text-slate-900">{value}</p>
      <p className="truncate text-[13px] text-slate-500">{label}</p>
    </div>
  </div>
);

export default function RequestPresentation({
  presentation,
  mode,
  withHeader = true,
  headerActions,
  notice,
  approvalBar,
  footer,
  renderGroupControls,
  renderTargetControls,
  renderPersonDetail,
  onViewExecutionRecap,
}: Props) {
  const { summary } = presentation;
  const reviewing = mode === 'internal_review';

  return (
    <div className="space-y-6" data-mode={mode}>
      {withHeader && <RequestPresentationHeader presentation={presentation} mode={mode} actions={headerActions} />}
      {presentation.request.rejection && <RequestRejection rejection={presentation.request.rejection} />}
      {notice}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <section
            aria-label="Request summary"
            className="grid grid-cols-2 gap-4 md:grid-cols-4"
          >
            <Summary icon={Users} tile="bg-blue-50 text-blue-600 ring-blue-100" label="People in snapshot" value={summary.people} />
            <Summary icon={ListChecks} tile="bg-indigo-50 text-indigo-600 ring-indigo-100" label="Requested actions" value={summary.requested_actions} />
            <Summary icon={Target} tile="bg-teal-50 text-teal-600 ring-teal-100" label="Concrete targets" value={summary.concrete_targets} />
            <Summary icon={Sparkles} tile="bg-amber-50 text-amber-600 ring-amber-100" label="New entities" value={summary.new_entities} />
          </section>

          <RequestPeopleSummary
            subjects={presentation.subjects}
            total={summary.people}
            renderPersonDetail={renderPersonDetail}
          />

          <RequestActionGroupList
            groups={presentation.action_groups}
            defaultExpanded={reviewing}
            renderGroupControls={renderGroupControls}
            renderTargetControls={renderTargetControls}
          />

          {mode === 'completed_detail' && presentation.fulfilment_outcome && (
            <FulfilmentOutcomeSummary
              outcome={presentation.fulfilment_outcome}
              onViewExecutionRecap={onViewExecutionRecap}
            />
          )}

          {footer}
        </div>

        <aside className="min-w-0 space-y-6">
          <RequestedEntitiesSummary entities={presentation.requested_entities} />
          <RequestInformationPanel request={presentation.request} />
          <RequestAttentionPanel items={presentation.attention} />
        </aside>
      </div>

      {approvalBar && <div className="sticky bottom-4 z-20">{approvalBar}</div>}
    </div>
  );
}
