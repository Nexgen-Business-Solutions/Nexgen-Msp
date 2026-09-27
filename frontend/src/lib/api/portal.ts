import type {
  DeviceDetail as DeviceFile,
  UserDetail as UserFile,
  UserHistory as UserFileHistory,
} from './internal';
import { download, get, post } from './client';

const BASE = 'nexgen_msp.api.portal.endpoints.v1';

export type PortalContext = {
  user: string;
  full_name: string;
  user_image: string | null;
  customers: string[];
  customer: string;
  roles: string[];
};

export type PortalSummary = {
  customer: string;
  client_users: number;
  active_client_users: number;
  devices: number;
  active_devices: number;
  retired_devices: number;
  disabled_client_users: number;
  service_assignments: number;
  active_services: number;
  open_requests: number;
  awaiting_approval: number;
  catalogue_size: number;
};

export type Paginated<T> = {
  rows: T[];
  start: number;
  page_length: number;
  total: number;
  has_more: boolean;
};

export type ClientUser = {
  name: string;
  full_name: string;
  username: string | null;
  active_services: number;
  inactive_services: number;
  suspended_services: number;
  ended_services: number;
  services: string | null;
  hostnames: string | null;
  device_type: string | null;
  department: string | null;
  email: string | null;
  lifecycle_status: string;
  start_date: string | null;
  disabled_date: string | null;
  customer: string;
  open_requests?: number;
  serial_numbers?: string | null;
  current_devices?: number;
  personal_services?: number;
  device_services?: number;
  last_billed_on?: string | null;
  covered_until?: string | null;
};

export type ManagedDevice = {
  name: string;
  hostname: string;
  device_type: string;
  status: string;
  assigned_client_user: string | null;
  assigned_date: string | null;
  retired_date: string | null;
  serial_number: string | null;
  manufacturer: string | null;
  model: string | null;
  operating_system: string | null;
  customer: string;
  assigned_user_name?: string | null;
  active_services: number;
  inactive_services: number;
  services: string | null;
  user_department?: string | null;
  last_billed_on?: string | null;
  covered_until?: string | null;
  interfaces?: { interface_type: string; mac_address: string }[];
};

export type ServiceAssignment = {
  name: string;
  service_item: string;
  assignment_scope: string;
  client_user: string | null;
  managed_device: string | null;
  customer_site: string | null;
  quantity: number;
  uom: string;
  operational_status: string;
  billing_status: string;
  effective_start_date: string | null;
  effective_end_date: string | null;
  customer_visible_notes: string | null;
  customer: string;
};

export type ServiceRequestLine = {
  idx: number;
  action: string;
  target_scope: string;
  /** the operation the line asks for, which is what the form offers — not the mechanical verb */
  operation_code?: string | null;
  operation_label_snapshot?: string | null;
  requested_holder?: string | null;
  is_new_user?: number;
  new_user_full_name?: string | null;
  new_user_department?: string | null;
  new_user_email?: string | null;
  new_user_username?: string | null;
  client_user: string | null;
  managed_device: string | null;
  /** the exact service period this line acts on, and who it was raised for */
  source_service_assignment?: string | null;
  requested_for_user?: string | null;
  is_new_device?: number;
  new_device_label?: string | null;
  new_device_type?: string | null;
  new_device_serial?: string | null;
  customer_site: string | null;
  requested_service: string;
  requested_quantity: number;
  requested_effective_date: string | null;
  comment: string | null;
  line_status: string;
  rejection_reason: string | null;
};

export type ServiceRequest = {
  name: string;
  request_type: string;
  status: string;
  priority: string;
  source: string;
  requester: string | null;
  customer: string;
  creation: string;
  modified: string;
};

export type ServiceRequestDetail = ServiceRequest & { lines: ServiceRequestLine[] };

export type CatalogueItem = {
  name: string;
  item_name: string;
  stock_uom: string;
  description: string | null;
  scope: string;
};

export type ListParams = {
  customer?: string;
  search?: string;
  status?: string;
  service?: string;
  coverage?: string;
  start?: number;
  page_length?: number;
};

export type NewRequestLine = {
  /** the operation asked for; the server derives the mechanical action type */
  operation_code?: string;
  action?: string;
  target_scope: string;
  is_new_user?: number;
  /** opaque builder group: keeps two future colleagues with the same name distinct */
  subject_key?: string;
  client_user?: string;
  new_user_full_name?: string;
  new_user_department?: string;
  new_user_email?: string;
  /** never required of the customer, but kept when they happen to know it */
  new_user_username?: string;
  is_new_device?: number;
  new_device_label?: string;
  new_device_type?: string;
  new_device_serial?: string;
  managed_device?: string;
  customer_site?: string;
  /** the exact service period this line acts on — required for anything but Add */
  source_service_assignment?: string;
  /** who the line was raised for, kept even when it targets a machine */
  requested_for_user?: string;
  /** who should hold the machine, for an operation that decides that */
  requested_holder?: string;
  /** an act on the machine itself names no service */
  requested_service?: string;
  /** how this subject came into the request, kept exactly as it was selected */
  selection_origin?: 'Individual' | 'Department' | 'Company';
  selection_group_key?: string;
  selection_label?: string;
  selection_snapshot_at?: string;
  requested_quantity?: number;
  requested_effective_date?: string;
  comment?: string;
};

export const getContext = (signal?: AbortSignal) =>
  get<PortalContext>(`${BASE}.get_context`, undefined, signal);

export const getSummary = (customer?: string, signal?: AbortSignal) =>
  get<PortalSummary>(`${BASE}.get_summary`, { customer }, signal);

export type UserChoice = {
  name: string;
  full_name: string;
  email: string | null;
  username: string | null;
  department: string | null;
  lifecycle_status: string;
  disabled_date: string | null;
  hostnames: string | null;
  serial_numbers: string | null;
};

export type ApprovalRights = {
  customer: string;
  has_authority: boolean;
  can_submit: boolean;
  can_approve: boolean;
  department: string | null;
  awaiting: number;
};

export const getMyApprovalRights = (signal?: AbortSignal) =>
  get<ApprovalRights>(`${BASE}.get_my_approval_rights`, undefined, signal);

export const approveRequest = (name: string, reason?: string) =>
  post<ServiceRequestDetail>(`${BASE}.approve_request`, { name, reason });

export const rejectRequest = (name: string, reason: string) =>
  post<ServiceRequestDetail>(`${BASE}.reject_request`, { name, reason });

export type PortalFilterOptions = {
  user_statuses: string[];
  device_statuses: string[];
  device_types: string[];
};

export const getPortalFilterOptions = (customer?: string, signal?: AbortSignal) =>
  get<PortalFilterOptions>(`${BASE}.get_portal_filter_options`, { customer }, signal);

export type MyExportParams = {
  coverage?: string;
  customer?: string;
  search?: string;
  status?: string;
  service?: string;
};

export type ExportPicks = { columns?: string[]; serviceColumns?: string[] };

const picked = (picks?: ExportPicks) => ({
  columns: picks?.columns?.length ? picks.columns : undefined,
  service_columns: picks?.serviceColumns?.length ? picks.serviceColumns : undefined,
});

export const exportMyPeople = (params: MyExportParams = {}, picks?: ExportPicks) =>
  download(`${BASE}.export_client_users`, { ...params, ...picked(picks) }, 'users.xlsx');

export const exportMyMachines = (params: MyExportParams = {}, picks?: ExportPicks) =>
  download(`${BASE}.export_devices`, { ...params, ...picked(picks) }, 'devices.xlsx');

export const listUserChoices = (customer?: string, signal?: AbortSignal) =>
  get<UserChoice[]>(`${BASE}.list_user_choices`, { customer }, signal);

export type DeviceChoice = {
  name: string;
  hostname: string;
  device_type: string | null;
  status: string;
  serial_number: string | null;
  assigned_client_user: string | null;
  assigned_user_name: string | null;
};

export const listDeviceChoices = (customer?: string, signal?: AbortSignal) =>
  get<DeviceChoice[]>(`${BASE}.list_device_choices`, { customer }, signal);

export const listClientUsers = (params: ListParams = {}, signal?: AbortSignal) =>
  get<Paginated<ClientUser>>(`${BASE}.list_client_users`, params, signal);

export type DepartmentOption = { value: string; label: string };

/** The one global department catalogue. No Customer context: it is the same list for
 * everyone. */
export const listDepartments = (signal?: AbortSignal) =>
  get<DepartmentOption[]>(`${BASE}.list_departments`, undefined, signal);

export const listDevices = (params: ListParams = {}, signal?: AbortSignal) =>
  get<Paginated<ManagedDevice>>(`${BASE}.list_devices`, params, signal);

export const listServiceAssignments = (
  params: ListParams & { client_user?: string } = {},
  signal?: AbortSignal
) => get<Paginated<ServiceAssignment>>(`${BASE}.list_service_assignments`, params, signal);

export const listRequests = (
  params: ListParams & { priority?: string; request_type?: string } = {},
  signal?: AbortSignal
) => get<Paginated<ServiceRequest>>(`${BASE}.list_requests`, params, signal);

export type PortalRequestLine = {
  idx: number;
  action: string;
  line_status: string;
  rejection_reason: string | null;
  is_new_user: number;
  subject_key?: string | null;
  new_user_full_name: string | null;
  new_user_department: string | null;
  is_new_device: number;
  new_device_label: string | null;
  user_name: string | null;
  department: string | null;
  username: string | null;
  service_name: string;
  action_label: string | null;
  hostname: string | null;
  serial_number: string | null;
  device_type: string | null;
  device_holder: string | null;
  requested_effective_date: string | null;
  comment: string | null;
  service_status: string | null;
  service_start_date: string | null;
  delivered_on: string | null;
  operation_code: string | null;
  operation_label_snapshot: string | null;
  operation_payload: string | null;
  state_snapshot: string | null;
  requested_holder: string | null;
  requested_holder_name: string | null;
  target_scope: string | null;
  service_scope: string;
  client_user: string | null;
  managed_device: string | null;
  /** the exact service period this line acts on, and who it was raised for */
  source_service_assignment: string | null;
  requested_for_user: string | null;
  requested_quantity: number | null;
  requested_service: string | null;
  new_user_email: string | null;
  new_user_username: string | null;
  new_device_type: string | null;
  new_device_serial: string | null;
};

export type PortalRequestDetail = {
  name: string;
  customer: string;
  request_type: string;
  status: string;
  priority: string;
  details?: string | null;
  source: string;
  creation: string;
  modified: string;
  rejection_reason: string | null;
  refused_by_customer?: boolean;
  reviewed_on: string | null;
  can_decide: boolean;
  has_approver: boolean;
  lines: PortalRequestLine[];
  /** what the customer actually built, when the request was raised the V3 way */
  subjects?: RequestSubjectSnapshot[];
  action_groups?: RequestActionGroupSnapshot[];
};

export type RequestSubjectSnapshot = {
  subject_key: string;
  client_user: string | null;
  is_new_user: boolean;
  full_name: string;
  department: string | null;
  email: string | null;
  added_via: string;
  selection_label: string | null;
};

export type RequestActionGroupSnapshot = {
  group_key: string;
  operation_code: string;
  operation_label_snapshot: string;
  domain: string;
  service_item: string | null;
  group_origin: string;
  source_scope_type: string;
  source_scope_key: string | null;
  source_scope_label: string | null;
  selected_subject_count: number;
  applicable_target_count: number;
  excluded_subject_count: number;
  impact: {
    subject_key: string;
    status: 'selected' | 'inapplicable';
    reason_code?: string;
    targets?: { target_type: string; target: string }[];
  }[];
};

export type PortalUserDevice = {
  name?: string;
  hostname: string;
  device_type: string;
  status: string;
  assigned_date?: string | null;
  held_from?: string | null;
  held_until?: string | null;
  is_current?: boolean;
};

export type PortalUserDeviceHistory = PortalUserDevice & { holder_record: string };

export type PortalUserService = {
  name: string;
  service_item: string;
  service_name: string;
  operational_status: string;
  quantity: number | null;
  effective_start_date: string | null;
  effective_end_date: string | null;
  source_request: string | null;
  allowed_actions: string[];
  pending_request: string | null;
};

export type PortalServiceHistory = Omit<PortalUserService, 'allowed_actions' | 'pending_request'>;


export const getRequest = (name: string, signal?: AbortSignal) =>
  get<PortalRequestDetail>(`${BASE}.get_request`, { name }, signal);

/** The same file our own team reads, bar what we wrote for ourselves. */
export const getUserFile = (clientUser: string, signal?: AbortSignal) =>
  get<UserFile>(`${BASE}.get_user_detail`, { client_user: clientUser }, signal);

export const getUserFileHistory = (clientUser: string, limit?: number, signal?: AbortSignal) =>
  get<UserFileHistory>(`${BASE}.get_user_history`, { client_user: clientUser, limit }, signal);

export const getDeviceFile = (device: string, signal?: AbortSignal) =>
  get<DeviceFile>(`${BASE}.get_device_detail`, { device }, signal);

export const listCatalogue = (customer?: string, signal?: AbortSignal) =>
  get<{ items: CatalogueItem[]; count: number; has_contract: boolean }>(
    `${BASE}.list_catalogue`,
    { customer },
    signal
  );

export type RequestPayload = {
  name?: string;
  customer?: string;
  request_type?: string;
  priority?: string;
  details?: string;
  lines?: NewRequestLine[];
  subjects?: RequestSubjectDraft[];
  action_groups?: RequestActionGroupDraft[];
};

/** The snapshot travels as JSON: it is a document the server keeps, not a form field. */
const packed = (payload: RequestPayload) => ({
  ...payload,
  subjects: payload.subjects ? JSON.stringify(payload.subjects) : undefined,
  action_groups: payload.action_groups ? JSON.stringify(payload.action_groups) : undefined,
});

export const createRequest = (payload: RequestPayload) =>
  post<ServiceRequestDetail>(`${BASE}.create_request`, packed(payload));

export const saveRequestDraft = (payload: RequestPayload) =>
  post<ServiceRequestDetail>(`${BASE}.save_request_draft`, packed(payload));

export const discardRequestDraft = (name: string) =>
  post<{ discarded: string }>(`${BASE}.discard_request_draft`, { name });

export type SubscribedService = {
  service_item: string;
  item_name: string;
  assignment_scope: string;
  total: number;
  active: number;
  ended: number;
};

export type ServiceRow = {
  name: string;
  client_user: string | null;
  user_name: string | null;
  department: string | null;
  email: string | null;
  user_status: string | null;
  hostname: string | null;
  device: string | null;
  quantity: number;
  uom: string;
  operational_status: string;
  billing_status: string;
  effective_start_date: string | null;
  effective_end_date: string | null;
  last_billed_on: string | null;
};

export type ServicePortfolioRow = {
  service_item: string;
  service_name: string;
  scope: string;
  availability: 'Available to request' | 'History only' | 'Temporarily unavailable';
  active: number;
  suspended: number;
  pending_setup: number;
  ended: number;
  cancelled: number;
  total: number;
};

export const getServicePortfolio = (customer?: string, signal?: AbortSignal) =>
  get<{ rows: ServicePortfolioRow[]; count: number; has_contract: boolean }>(
    `${BASE}.get_service_portfolio`,
    { customer },
    signal
  );

export const listSubscribedServices = (customer?: string, signal?: AbortSignal) =>
  get<{ services: SubscribedService[]; count: number }>(
    `${BASE}.list_subscribed_services`,
    { customer },
    signal
  );

export const listServiceRows = (
  params: ListParams & { service_item: string },
  signal?: AbortSignal
) => get<Paginated<ServiceRow>>(`${BASE}.list_service_rows`, params, signal);

export type UserWithServices = {
  name: string;
  full_name: string;
  department: string | null;
  email: string | null;
  lifecycle_status: string;
  start_date: string | null;
  hostname: string | null;
  device_type: string | null;
  service_count: number;
};

export const listUsersWithServices = (params: ListParams = {}, signal?: AbortSignal) =>
  get<Paginated<UserWithServices>>(`${BASE}.list_users_with_services`, params, signal);

export type KpiName = 'active_services' | 'open_requests';

export type KpiColumn = { key: string; label: string };

export type KpiRow = { name: string } & Record<string, string | number | null>;

export type KpiRows = Paginated<KpiRow> & {
  kpi: KpiName;
  title: string;
  columns: KpiColumn[];
};

export const listKpiRows = (
  params: { kpi: KpiName; customer?: string; start?: number; page_length?: number },
  signal?: AbortSignal
) => get<KpiRows>(`${BASE}.list_kpi_rows`, params, signal);

export type PortalBillingRow = {
  name: string;
  billing_period_start: string;
  billing_period_end: string;
  total_amount: number;
  currency: string | null;
  sales_invoice: string | null;
  adjustment_of: string | null;
  approved_at: string | null;
  invoice_status: string | null;
  invoice_docstatus: number | null;
  posting_date: string | null;
  line_count: number;
  disputed: number;
  dispute_reason: string | null;
  disputed_on: string | null;
};

export type PortalBillingLine = {
  user_name: string | null;
  department: string | null;
  hostname: string | null;
  device_type: string | null;
  started_on: string | null;
  stopped_on: string | null;
  state: string;
  billable_days: number;
  period_days: number;
  billable_months: number;
  unit_rate: number | null;
  amount: number;
};

export type PortalBillingDetail = {
  run: {
    name: string;
    customer: string;
    status: string;
    billing_period_start: string;
    billing_period_end: string;
    total_amount: number;
    currency: string | null;
    sales_invoice: string | null;
    adjustment_of: string | null;
    disputed: number;
    dispute_reason: string | null;
    disputed_on: string | null;
    dispute_request: string | null;
  };
  invoice: {
    name: string;
    posting_date: string;
    grand_total: number;
    status: string;
    docstatus: number;
  } | null;
  services: {
    service_name: string;
    lines: PortalBillingLine[];
    quantity: number;
    months: number;
    amount: number;
  }[];
  line_count: number;
  dispute_window: {
    days: number;
    closes_on: string | null;
    open: boolean;
  };
  can_dispute: boolean;
  dispute_outcome: {
    request: string;
    settled: boolean;
    note: string | null;
  } | null;
};

export const listBilling = (customer?: string, signal?: AbortSignal) =>
  get<PortalBillingRow[]>(`${BASE}.list_billing`, { customer }, signal);

export const getBillingDetail = (name: string, signal?: AbortSignal) =>
  get<PortalBillingDetail>(`${BASE}.get_billing_detail`, { name }, signal);

export const downloadInvoice = (name: string) =>
  download(`${BASE}.download_invoice`, { name }, `${name}.pdf`);

export const downloadBreakdown = (name: string) =>
  download(`${BASE}.download_breakdown`, { name }, `${name}-breakdown.xlsx`);

export type ReportFilterOptions = {
  services: { value: string; label: string }[];
  statuses: string[];
  departments: string[];
  user_statuses: string[];
};

export type ReportQuery = {
  service_item?: string;
  search?: string;
  status?: string;
  department?: string;
  user_status?: string;
  last_billed_after?: string;
  last_billed_before?: string;
  start?: number;
  page_length?: number;
};

export const getReportFilterOptions = (customer?: string, signal?: AbortSignal) =>
  get<ReportFilterOptions>(`${BASE}.get_report_filter_options`, { customer }, signal);

export const listReportRows = (params: ReportQuery = {}, signal?: AbortSignal) =>
  get<Paginated<ServiceRow & { service_item: string; service_name: string }>>(
    `${BASE}.list_service_rows`,
    params,
    signal
  );

export type PortalRequestFilterOptions = {
  statuses: string[];
  priorities: string[];
  request_types: string[];
  used_types: string[];
};

export const getRequestFilterOptions = (customer?: string, signal?: AbortSignal) =>
  get<PortalRequestFilterOptions>(`${BASE}.get_request_filter_options`, { customer }, signal);

export const disputeInvoice = (payload: { name: string; reason: string }) =>
  post<{ disputed: boolean; run: string }>(`${BASE}.dispute_invoice`, payload);

export type ActivityKind =
  | 'invoice'
  | 'credit_note'
  | 'request'
  | 'user'
  | 'device'
  | 'service_started'
  | 'service_ended';

export type ActivityEvent = {
  kind: ActivityKind;
  on: string;
  title: string;
  detail: string;
  link: string | null;
};

export const getRecentActivity = (customer?: string, limit = 12, signal?: AbortSignal) =>
  get<{ rows: ActivityEvent[]; count: number }>(
    `${BASE}.get_recent_activity`,
    { customer, limit },
    signal
  );

export type RequestOperation = {
  code: string;
  label: string;
  description?: string | null;
};

export type ServiceState = {
  held: boolean;
  live?: boolean;
  status?: string;
  billing_status?: string;
  since?: string | null;
  until?: string | null;
  last_billed_on?: string | null;
};

export const getServiceState = (
  params: { service_item: string; client_user?: string; managed_device?: string },
  signal?: AbortSignal
) => get<ServiceState>(`${BASE}.get_service_state`, params, signal);

// ---------------------------------------------------------------- request builder

export type RequestUserResult = {
  name: string;
  full_name: string;
  email: string | null;
  department: string | null;
  lifecycle_status: string;
};

export type RequestServiceOffer = {
  service_item: string;
  item_name: string;
  service_scope: string | null;
  warning?: string | null;
  allowed_operations: RequestOperation[];
};

export type RequestCurrentService = {
  assignment: string;
  service_item: string;
  label: string;
  status: string;
  since: string | null;
  quantity: number | null;
  managed_device: string | null;
  hostname: string | null;
  pending_request: string | null;
  allowed_operations: RequestOperation[];
};

export type RequestDeviceContext = {
  name: string;
  hostname: string;
  serial_number: string | null;
  device_type: string | null;
  status: string;
  assigned_date: string | null;
  target_reason: string | null;
  services: {
    current: RequestCurrentService[];
    available: RequestServiceOffer[];
  };
};

export type RequestSubjectContext = {
  user: {
    name: string;
    customer: string;
    full_name: string;
    email: string | null;
    department: string | null;
    lifecycle_status: string;
    username?: string | null;
    start_date?: string | null;
  };
  personal_services: {
    current: RequestCurrentService[];
    available: RequestServiceOffer[];
  };
  target_reason: string | null;
  devices: RequestDeviceContext[];
  new_device_services?: RequestServiceOffer[];
  assignable_devices?: {
    name: string;
    hostname: string;
    serial_number: string | null;
    device_type: string | null;
    status: string;
    assigned_client_user: string | null;
    holder_name: string | null;
  }[];
};

export type NewUserRequestContext = {
  customer: string;
  departments: { value: string; label: string }[];
  available_user_services: RequestServiceOffer[];
  available_device_services: RequestServiceOffer[];
};

export type RequestSubmissionContext = {
  customer: string;
  may_submit: boolean;
  needs_customer_approval: boolean;
  message: string;
};

export type SelectionPerson = {
  name: string;
  full_name: string;
  email: string | null;
  department: string | null;
  lifecycle_status: string;
};

/** Who a Department or the whole company would add, resolved once and kept as a snapshot. */
export type GroupSelection = {
  customer: string;
  selection_origin: 'Department' | 'Company';
  selection_label: string;
  selection_group_key: string;
  selection_snapshot_at: string;
  active_count: number;
  excluded_disabled_count: number;
  department_count: number;
  departments: string[];
  people: SelectionPerson[];
  excluded: SelectionPerson[];
};

export const getDepartmentSelection = (
  params: { customer?: string; department: string },
  signal?: AbortSignal
) => get<GroupSelection>(`${BASE}.get_department_selection`, params, signal);

export const getCompanySelection = (customer?: string, signal?: AbortSignal) =>
  get<GroupSelection>(`${BASE}.get_company_selection`, { customer }, signal);

export type BulkTarget = {
  client_user: string;
  full_name: string;
  department?: string | null;
  target_scope: 'User' | 'Device';
  managed_device: string | null;
  hostname: string | null;
  source_service_assignment: string | null;
};

export type BulkExclusion = BulkTarget & { reason: string };

export type BulkResolution = {
  customer: string;
  operation_code: string;
  operation_label: string;
  service_item: string;
  service_scope: string;
  eligible: BulkTarget[];
  excluded: BulkExclusion[];
  eligible_count: number;
  excluded_count: number;
  device_count: number;
};

export const resolveBulkTargets = (payload: {
  customer?: string;
  operation_code: string;
  service_item: string;
  people: string[];
}) =>
  post<BulkResolution>(`${BASE}.resolve_bulk_targets`, {
    ...payload,
    people: JSON.stringify(payload.people),
  });

export const searchRequestUsers = (
  params: { customer?: string; search?: string; limit?: number } = {},
  signal?: AbortSignal
) => get<RequestUserResult[]>(`${BASE}.search_request_users`, params, signal);

export const getRequestSubjectContext = (clientUser: string, signal?: AbortSignal) =>
  get<RequestSubjectContext>(
    `${BASE}.get_request_subject_context`,
    { client_user: clientUser },
    signal
  );

export const getNewUserRequestContext = (customer?: string, signal?: AbortSignal) =>
  get<NewUserRequestContext>(`${BASE}.get_new_user_request_context`, { customer }, signal);

export const getRequestSubmissionContext = (customer?: string, signal?: AbortSignal) =>
  get<RequestSubmissionContext>(`${BASE}.get_request_submission_context`, { customer }, signal);


/* ------------------------------------------------------------------ Request Builder V3 */

/** One person in the request snapshot, whichever door they came in through. */
export type RequestSubjectDraft = {
  subject_key: string;
  client_user?: string | null;
  is_new_user?: boolean;
  full_name?: string;
  department?: string | null;
  email?: string | null;
  username?: string | null;
  added_via?: 'Existing' | 'New' | 'Department' | 'Company';
  selection_label?: string | null;
};

/** The same person as the server reads them: what they hold and what runs on them today. */
export type RequestSubjectRow = {
  subject_key: string;
  client_user: string | null;
  is_new_user: 0 | 1;
  full_name: string;
  department: string | null;
  email: string | null;
  username: string | null;
  added_via: string;
  selection_label: string | null;
  devices: { name: string; label: string; status: string }[];
  current_services: {
    assignment: string;
    service_item: string;
    label: string;
    scope: 'User' | 'Device';
    status: string;
    managed_device: string | null;
  }[];
  last_billed: string | null;
  usable: boolean;
  reason_code: string | null;
};

export type RequestTarget = {
  subject_key: string;
  client_user: string | null;
  full_name: string;
  department?: string | null;
  target_scope: 'User' | 'Device';
  managed_device: string | null;
  device_label: string | null;
  source_service_assignment: string | null;
  current_state?: string | null;
  current_holder?: string | null;
  current_holder_label?: string | null;
  requested_holder?: string | null;
};

export type RequestExclusion = {
  subject_key: string;
  client_user: string | null;
  full_name: string;
  managed_device: string | null;
  device_label: string | null;
  reason_code: string;
  reason: string;
};

export type RequestOperationOption = {
  operation_code: string;
  operation_label: string;
  operation_label_snapshot: string;
  object_key: string | null;
  object_label: string;
  targets: RequestTarget[];
  exclusions: RequestExclusion[];
  applicable_target_count: number;
  applicable_subject_count: number;
  excluded_subject_count: number;
  device_count?: number;
  holder_options?: { value: string; label: string }[];
};

export type RequestServiceOption = {
  object_key: string;
  object_label: string;
  service_scope: string;
  current_count: number;
  without_count: number;
  actions: RequestOperationOption[];
};

export type RequestOperationDomain =
  | { key: 'Service'; label: string; options: RequestServiceOption[] }
  | { key: 'Device'; label: string; options: RequestOperationOption[] };

export type RequestActionGroupDraft = {
  group_key: string;
  operation_code: string;
  operation_label_snapshot: string;
  domain: 'Service' | 'Device' | 'People';
  service_item?: string | null;
  source_scope_type: 'All' | 'Department' | 'Person';
  source_scope_key?: string | null;
  source_scope_label: string;
  selected_subject_count: number;
  targets: RequestTarget[];
  exclusions: RequestExclusion[];
};

export const evaluateRequestScope = (
  payload: { customer?: string; subjects: RequestSubjectDraft[] },
  signal?: AbortSignal
) =>
  get<{ customer: string; subjects: RequestSubjectRow[] }>(
    `${BASE}.evaluate_request_scope`,
    { customer: payload.customer, subjects: JSON.stringify(payload.subjects) },
    signal
  );

export const evaluateRequestOperations = (
  payload: { customer?: string; subjects: RequestSubjectDraft[]; subject_keys: string[] },
  signal?: AbortSignal
) =>
  get<{
    customer: string;
    selected_subject_count: number;
    domains: RequestOperationDomain[];
  }>(
    `${BASE}.evaluate_request_operations`,
    {
      customer: payload.customer,
      subjects: JSON.stringify(payload.subjects),
      subject_keys: JSON.stringify(payload.subject_keys),
    },
    signal
  );
