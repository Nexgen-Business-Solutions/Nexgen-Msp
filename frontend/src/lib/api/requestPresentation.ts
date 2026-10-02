import { get, post } from './client';
import type { RequestActionGroupDraft, RequestedDeviceDraft, RequestSubjectDraft } from './portal';

const PORTAL = 'nexgen_msp.api.portal.endpoints.v1';
const INTERNAL = 'nexgen_msp.api.internal.endpoints.v1';

export type RequestPresentationMode =
  | 'creation_review'
  | 'customer_approval'
  | 'portal_detail'
  | 'internal_review'
  | 'internal_detail'
  | 'completed_detail';

export type RequestPresentation = {
  request: {
    name: string | null;
    status: string;
    customer: string;
    customer_name: string | null;
    requester: string | null;
    requester_name: string | null;
    requested_date: string | null;
    priority: string;
    source: string | null;
    submitted_at: string | null;
    details: string | null;
    details_by: string | null;
    details_at: string | null;
    badges: { tone: 'blue' | 'slate' | 'amber' | 'emerald' | 'red'; label: string }[];
    customer_approval: {
      state: 'not_applicable' | 'pending' | 'approved' | 'rejected';
      by_name: string | null;
      at: string | null;
      label: string;
    };
    nexgen_status_label: string;
    rejection: {
      reason: string;
      by: 'customer' | 'nexgen';
      by_name: string | null;
      at: string | null;
    } | null;
    completed_at: string | null;
    modified: { by_name: string | null; at: string } | null;
  };
  summary: {
    people: number;
    requested_actions: number;
    concrete_targets: number;
    new_entities: number;
  };
  subjects: RequestSubjectPresentation[];
  action_groups: RequestActionGroupPresentation[];
  requested_entities: RequestedEntityPresentation[];
  attention: string[];
  fulfilment_outcome: FulfilmentOutcomePresentation | null;
};

export type RequestSubjectPresentation = {
  subject_key: string;
  full_name: string;
  department: string | null;
  type: 'existing' | 'new' | 'device';
  client_user: string | null;
  managed_device?: string | null;
  requested_client_user: string | null;
  related_work_count: number;
};

export type RequestRelationship = {
  from_label: string | null;
  to_label: string;
  to_is_new: boolean;
  note: string | null;
};

export type RequestTargetPresentation = {
  line_idx: number | null;
  subject_key: string | null;
  person_label: string | null;
  person_is_new: boolean;
  target_label: string;
  target_kind: 'client_user' | 'requested_client_user' | 'managed_device' | 'requested_device';
  target_name?: string | null;
  target_badge: 'NEW' | 'NEW DEVICE' | 'UNRESOLVED' | null;
  operation_label: string;
  state_at_request: string | null;
  state_changed: boolean;
  relationship: RequestRelationship | null;
  line_status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled' | null;
  rejection_reason: string | null;
  work_cancelled?: boolean;
};

export type RequestActionGroupPresentation = {
  group_key: string;
  operation_code: string;
  operation_label: string;
  domain: 'Service' | 'Device' | 'People';
  context_label: string;
  impact_label: string;
  impact_detail: string | null;
  target_count: number;
  unchanged_count: number;
  badges: { tone: 'amber' | 'slate'; label: string }[];
  relationship: RequestRelationship | null;
  targets: RequestTargetPresentation[];
  unchanged: { subject_key: string; person_label: string; reason: string }[];
};

export type RequestedEntityPresentation = {
  kind: 'client_user' | 'device';
  name: string | null;
  key: string;
  display_name: string;
  context_label: string;
  status: 'Open' | 'Resolved' | 'Cancelled';
  readiness: 'needs_review' | 'needs_information' | 'ready' | 'resolved' | 'cancelled';
  badge: string;
  resolved_to: {
    doctype: 'MSP Client User' | 'MSP Managed Device';
    name: string;
    label: string;
    mode: string | null;
  } | null;
  requested_snapshot: Record<string, unknown>;
  prepared_values: Record<string, unknown>;
  requested_work_count: number;
  relationship_summary: string[];
  intended_holder_requested_client_user?: string | null;
  blocked_by?: { name: string; label: string } | null;
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
};

export type FulfilmentOutcomePresentation = {
  entities: {
    kind: 'client_user' | 'device';
    display_name: string;
    context_label: string;
    badge: string;
    resolved_label: string | null;
    resolved_note: string | null;
    link: { doctype: 'MSP Client User' | 'MSP Managed Device'; name: string } | null;
  }[];
  work: { completed: number; unresolved: number; cancelled?: number; badge: string };
};

export type RequestPreviewPayload = {
  customer?: string | null;
  priority?: string | null;
  details?: string | null;
  requested_date?: string | null;
  subjects: RequestSubjectDraft[];
  requested_devices: RequestedDeviceDraft[];
  action_groups: RequestActionGroupDraft[];
};

export const getPortalRequestPresentation = (name: string, signal?: AbortSignal) =>
  get<RequestPresentation>(`${PORTAL}.get_request_presentation`, { name }, signal);

export const previewRequest = (payload: RequestPreviewPayload, signal?: AbortSignal) =>
  post<RequestPresentation>(
    `${PORTAL}.preview_request`,
    {
      ...payload,
      subjects: JSON.stringify(payload.subjects),
      requested_devices: JSON.stringify(payload.requested_devices),
      action_groups: JSON.stringify(payload.action_groups),
    },
    signal
  );

export const getInternalRequestPresentation = (name: string, signal?: AbortSignal) =>
  get<RequestPresentation>(`${INTERNAL}.get_request_presentation`, { name }, signal);
