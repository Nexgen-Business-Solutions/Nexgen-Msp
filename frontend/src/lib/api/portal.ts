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
  reclaimable_licences: number;
  devices_without_services: number;
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
  services: string | null;
  hostnames: string | null;
  device_type: string | null;
  department: string | null;
  email: string | null;
  lifecycle_status: string;
  start_date: string | null;
  disabled_date: string | null;
  customer: string;
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
  /** the configured action, which is what the form offers — not the mechanical verb */
  request_action?: string | null;
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
  /** the chosen MSP Request Action; the server derives the mechanical action type */
  request_action?: string;
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
  requested_service: string;
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

export const exportMyPeople = (params: MyExportParams = {}) =>
  download(`${BASE}.export_client_users`, params, 'users.xlsx');

export const exportMyMachines = (params: MyExportParams = {}) =>
  download(`${BASE}.export_devices`, params, 'devices.xlsx');

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
  request_action: string | null;
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
  reviewed_on: string | null;
  can_decide: boolean;
  has_approver: boolean;
  lines: PortalRequestLine[];
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

export type PortalUserDetail = {
  user: {
    name: string;
    full_name: string;
    department: string | null;
    customer: string;
    email: string | null;
    username: string | null;
    lifecycle_status: string;
    start_date: string | null;
    disabled_date: string | null;
  };
  summary: {
    current_devices: number;
    active_personal_services: number;
    active_device_services: number;
    open_requests: number;
    attention_count: number;
  };
  personal_services: { current: PortalUserService[]; available: []; blocked: []; target_reason: null };
  devices: {
    device: {
      name: string;
      hostname: string;
      device_type: string | null;
      status: string;
      serial_number: string | null;
      in_service_since: string | null;
    };
    holder_since: string | null;
    interfaces: { interface_type: string; mac_address: string }[];
    services: { current: PortalUserService[]; history?: PortalServiceHistory[]; available: [] };
  }[];
  open_requests: {
    name: string;
    status: string;
    priority: string;
    request_type: string;
    creation: string;
    lines: { idx: number; action: string; service_name: string; hostname: string | null }[];
  }[];
  attention: {
    code: string;
    severity: 'warning' | 'info';
    entity_type: string;
    entity: string;
    message: string;
  }[];
  recent_activity: { on: string; kind: string; entity: string; what: string; via?: string | null }[];
};

export const getRequest = (name: string, signal?: AbortSignal) =>
  get<PortalRequestDetail>(`${BASE}.get_request`, { name }, signal);

export const getUserDetail = (clientUser: string, signal?: AbortSignal) =>
  get<PortalUserDetail>(`${BASE}.get_user_detail`, { client_user: clientUser }, signal);

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
  lines: NewRequestLine[];
};

export const createRequest = (payload: RequestPayload) =>
  post<ServiceRequestDetail>(`${BASE}.create_request`, payload);

export const saveRequestDraft = (payload: RequestPayload) =>
  post<ServiceRequestDetail>(`${BASE}.save_request_draft`, payload);

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

export type KpiName =
  | 'active_services'
  | 'open_requests'
  | 'reclaimable_licences'
  | 'devices_without_services';

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

export type RequestAction = {
  name: string;
  title: string;
  action_type: string;
  description: string | null;
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

export const listRequestActions = (forNewUser?: boolean, signal?: AbortSignal) =>
  get<RequestAction[]>(
    `${BASE}.list_request_actions`,
    { for_new_user: forNewUser ? 1 : 0 },
    signal
  );

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
  allowed_request_actions: RequestAction[];
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
  allowed_request_actions: RequestAction[];
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
  open_requests?: { name: string; status: string; creation: string }[];
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
