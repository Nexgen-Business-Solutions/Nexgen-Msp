import type { ReactNode } from 'react';
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

const Summary = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
    <p className="text-lg font-bold leading-tight text-slate-900">{value}</p>
    <p className="text-[11px] text-slate-500">{label}</p>
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
    <div className="space-y-4" data-mode={mode}>
      {withHeader && <RequestPresentationHeader presentation={presentation} mode={mode} actions={headerActions} />}
      {presentation.request.rejection && <RequestRejection rejection={presentation.request.rejection} />}
      {notice}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <section
            aria-label="Request summary"
            className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 shadow-sm md:grid-cols-4"
          >
            <Summary label="People in snapshot" value={summary.people} />
            <Summary label="Requested actions" value={summary.requested_actions} />
            <Summary label="Concrete targets" value={summary.concrete_targets} />
            <Summary label="New entities" value={summary.new_entities} />
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

        <aside className="min-w-0 space-y-4">
          <RequestedEntitiesSummary entities={presentation.requested_entities} />
          <RequestInformationPanel request={presentation.request} />
          <RequestAttentionPanel items={presentation.attention} />
        </aside>
      </div>

      {approvalBar && <div className="sticky bottom-4 z-20">{approvalBar}</div>}
    </div>
  );
}
