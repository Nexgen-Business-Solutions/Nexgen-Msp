import { download, get, post, postForm } from './client';
import type { Paginated } from './portal';

const BASE = 'nexgen_msp.api.internal.endpoints.v1';

export type RequestFilterOptions = {
  customers: string[];
  statuses: string[];
  open_statuses: string[];
  request_types: string[];
  priorities: string[];
  is_admin: boolean;
};

export type RequestStats = {
  open: number;
  urgent_open: number;
  ageing_open: number;
  under_review: number;
  awaiting_review: number;
  in_progress: number;
  completed: number;
  by_status: Record<string, number>;
};

export type RequestRow = {
  name: string;
  customer: string;
  request_type: string;
  status: string;
  priority: string;
  source: string;
  requester: string | null;
  billing_run: string | null;
  creation: string;
  modified: string;
  line_count: number;
  pending_lines: number;
  users: string | null;
  age_hours: number;
};

export type RequestAction = {
  action: string;
  label: string;
  needs_reason: boolean;
};

export type RequestDetailLine = {
  idx: number;
  action: string;
  target_scope: string;
  is_new_user: number;
  client_user: string | null;
  client_user_name: string | null;
  client_user_department: string | null;
  new_user_full_name: string | null;
  new_user_department: string | null;
  new_user_email: string | null;
  needs_portal_access: number;
  is_new_device: number;
  new_device_label: string | null;
  managed_device: string | null;
  device_hostname: string | null;
  requested_service: string;
  requested_service_name: string | null;
  requested_quantity: number;
  requested_effective_date: string | null;
  comment: string | null;
  device_serial: string | null;
  client_username: string | null;
  needs_serial: boolean;
  needs_username: boolean;
  line_status: string;
  rejection_reason: string | null;
};

export type RequestDetail = {
  name: string;
  customer: string;
  billing_run: string | null;
  request_type: string;
  status: string;
  priority: string;
  source: string;
  requester: string | null;
  requester_name: string | null;
  creation: string;
  modified: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  lines: RequestDetailLine[];
  available_actions: RequestAction[];
  can_decide_lines: boolean;
  review: RequestReview | null;
};

export type RequestReview = {
  has_contract: boolean;
  contract_status: string | null;
  contract_active: boolean;
  currency: string | null;
  shows_rates: boolean;
  lines: { idx: number; priced: boolean; rate: number | null; duplicate: string | null }[];
};

export type RequestListParams = {
  search?: string;
  status?: string;
  priority?: string;
  request_type?: string;
  customer?: string;
  scope?: string;
  start?: number;
  page_length?: number;
};

export const getRequestFilterOptions = (signal?: AbortSignal) =>
  get<RequestFilterOptions>(`${BASE}.get_request_filter_options`, undefined, signal);

export const getRequestStats = (params: RequestListParams = {}, signal?: AbortSignal) =>
  get<RequestStats>(`${BASE}.get_request_stats`, params, signal);

export const listRequests = (params: RequestListParams = {}, signal?: AbortSignal) =>
  get<Paginated<RequestRow>>(`${BASE}.list_requests`, params, signal);

export const setRequestDeliveryDetail = (payload: {
  name: string;
  idx: number;
  serial_number?: string;
  username?: string;
}) => post<RequestDetail>(`${BASE}.set_request_delivery_detail`, payload);

export const getRequest = (name: string, signal?: AbortSignal) =>
  get<RequestDetail>(`${BASE}.get_request`, { name }, signal);

export const runRequestAction = (payload: { name: string; action: string; reason?: string }) =>
  post<RequestDetail>(`${BASE}.run_request_action`, payload);

export const setRequestLineStatus = (payload: {
  name: string;
  idx: number;
  line_status: string;
  reason?: string;
}) => post<RequestDetail>(`${BASE}.set_request_line_status`, payload);

export type DeviceInterface = {
  interface_type: string;
  mac_address: string;
};

export type ContextDevice = {
  name: string;
  hostname: string;
  device_type: string;
  status: string;
  assigned_client_user: string | null;
  assigned_date: string | null;
  interfaces?: DeviceInterface[];
};

export type AssignmentInfo = {
  name: string;
  assignment_scope: string;
  managed_device: string | null;
  operational_status: string;
  billing_status: string;
  effective_start_date: string | null;
};



export type DashboardQueueRow = {
  name: string;
  customer: string;
  request_type: string;
  status: string;
  priority: string;
  creation: string;
  age_hours: number;
  line_count: number;
  users: string | null;
};

export type DashboardPendingLine = {
  request: string;
  idx: number;
  action: string;
  customer: string;
  priority: string;
  user_name: string | null;
  holder_username: string | null;
  service: string;
  hostname: string | null;
  requested_effective_date: string | null;
  comment: string | null;
};

export type DashboardPortfolio = {
  customers: number;
  client_users: number;
  active_client_users: number;
  devices: number;
  active_services: number;
  billable_services: number;
  added_this_month: number;
  removed_this_month: number;
  rated_services: number;
  by_service: { service: string; total: number; billable: number }[];
};

export type InternalDashboard = {
  is_admin: boolean;
  requests: {
    open: number;
    urgent_open: number;
    ageing_open: number;
    awaiting_review: number;
    under_review: number;
    in_progress: number;
    completed: number;
    lines_to_execute: number;
  };
  queue: DashboardQueueRow[];
  pending_lines: DashboardPendingLine[];
  hygiene: { unprotected_devices: number; reclaimable_licences: number };
  portfolio?: DashboardPortfolio;
};

export const getDashboard = (signal?: AbortSignal) =>
  get<InternalDashboard>(`${BASE}.get_dashboard`, undefined, signal);

export type UserFilterOptions = {
  customers: string[];
  departments: string[];
  services: { value: string; label: string }[];
  statuses: string[];
  coverage: string[];
};

export type UserStats = {
  active_users: number;
  without_device: number;
  disabled_with_services: number;
  unprotected_devices: number;
};

export type UserRow = {
  name: string;
  full_name: string;
  username: string | null;
  department: string | null;
  customer: string;
  lifecycle_status: string;
  start_date: string | null;
  disabled_date: string | null;
  email: string | null;
  remarks: string | null;
  services: string | null;
  inactive_service_names: string | null;
  hostnames: string | null;
  device_type: string | null;
  active_services: number;
  inactive_services: number;
};

export type UserDevice = {
  name: string;
  hostname: string;
  device_type: string;
  status: string;
  serial_number: string | null;
  assigned_date: string | null;
  retired_date: string | null;
  interfaces?: DeviceInterface[];
};

export type UserServiceRow = {
  name: string;
  service_item: string;
  service_name: string;
  assignment_scope: string;
  managed_device: string | null;
  hostname: string | null;
  operational_status: string;
  billing_status: string;
  effective_start_date: string | null;
  effective_end_date: string | null;
  source_request: string | null;
};

export type CustomerRequestRef = {
  name: string;
  request_type: string;
  status: string;
  priority: string;
  source: string;
  requester: string | null;
  creation: string;
  customer: string;
};

export type RemarkEntry = {
  note: string;
  noted_on: string | null;
  noted_by: string | null;
  idx: number;
};

export type UserDetail = {
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
    portal_user: string | null;
    remarks: string | null;
    remark_log: RemarkEntry[];
    covered_until: string | null;
    last_billed_on: string | null;
    can_delete: boolean;
    delete_blockers: string[];
  };
  devices: UserDevice[];
  services: UserServiceRow[];
  requests: { name: string; status: string; priority: string; request_type: string; creation: string }[];
  customer_requests: CustomerRequestRef[];
  device_types: string[];
  interface_types: string[];
  catalogue: { name: string; item_name: string; scope: string }[];
};

export type DeviceDetail = {
  device: {
    name: string;
    hostname: string;
    device_type: string;
    status: string;
    customer: string;
    assigned_client_user: string | null;
    user_name: string | null;
    assigned_date: string | null;
    retired_date: string | null;
    serial_number: string | null;
    asset_tag: string | null;
    manufacturer: string | null;
    model: string | null;
    operating_system: string | null;
    remarks: string | null;
    remark_log: RemarkEntry[];
    last_billed_on: string | null;
    covered_until: string | null;
    can_delete: boolean;
    delete_blockers: string[];
  };
  holder_log: {
    client_user: string;
    full_name: string | null;
    from_date: string | null;
    to_date: string | null;
    note: string | null;
    is_current: number;
    idx: number;
    lifecycle_status: string | null;
    disabled_date: string | null;
  }[];
  interfaces: DeviceInterface[];
  services: (UserServiceRow & { last_billed_on: string | null; internal_notes: string | null })[];
  requests: { name: string; status: string; priority: string; request_type: string; creation: string }[];
  catalogue: { name: string; item_name: string; scope: string; already_open: boolean }[];
  customer_requests: CustomerRequestRef[];
  device_types: string[];
  interface_types: string[];
};

export const addRemark = (payload: { doctype: string; name: string; note: string }) =>
  post<RemarkEntry[]>(`${BASE}.add_remark`, payload);

export const deleteDevice = (device: string) =>
  post<{ deleted: string }>(`${BASE}.delete_device`, { device });

export const getDevice = (device: string, signal?: AbortSignal) =>
  get<DeviceDetail>(`${BASE}.get_device`, { device }, signal);

export type UserListParams = {
  search?: string;
  customer?: string;
  status?: string;
  department?: string;
  service?: string;
  coverage?: string;
  portal?: string;
  start?: number;
  page_length?: number;
};

export const getUserFilterOptions = (signal?: AbortSignal) =>
  get<UserFilterOptions>(`${BASE}.get_user_filter_options`, undefined, signal);

export const getUserStats = (params: UserListParams = {}, signal?: AbortSignal) =>
  get<UserStats>(`${BASE}.get_user_stats`, params, signal);

export const listUsers = (params: UserListParams = {}, signal?: AbortSignal) =>
  get<Paginated<UserRow>>(`${BASE}.list_users`, params, signal);

export const getUser = (name: string, signal?: AbortSignal) =>
  get<UserDetail>(`${BASE}.get_user`, { name }, signal);

export const deleteClientUser = (name: string) =>
  post<{ deleted: string }>(`${BASE}.delete_client_user`, { name });

export const assignUserService = (payload: {
  client_user: string;
  service_item: string;
  effective_date?: string;
  device_mode?: 'existing' | 'new' | 'none';
  managed_device?: string;
  hostname?: string;
  device_type?: string;
  interfaces?: DeviceInterface[];
  serial_number?: string;
  username?: string;
  notes?: string;
  source_request?: string;
  target_scope?: 'User' | 'Device';
}) =>
  post<UserDetail>(`${BASE}.assign_user_service`, {
    ...payload,
    interfaces: payload.interfaces ? JSON.stringify(payload.interfaces) : undefined,
  });

export const changeUserService = (payload: {
  assignment: string;
  action: 'Suspend' | 'Resume' | 'End';
  effective_date?: string;
  notes?: string;
  source_request?: string;
}) => post<UserDetail>(`${BASE}.change_user_service`, payload);

export type ContractOptions = {
  contract_statuses: string[];
  billing_timings: string[];
  proration_methods: string[];
  invoice_groupings: string[];
  price_lists: string[];
  currencies: string[];
  cost_centers: string[];
  company: string | null;
  company_currency: string | null;
};

export type ContractRow = {
  customer: string;
  last_billed_on: string | null;
  contract: string | null;
  contract_title: string | null;
  contract_status: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  billing_frequency: string | null;
  currency: string | null;
  billable_assignments: number;
  services_used: number;
  services_priced: number;
};

export type ContractProfile = {
  name?: string;
  contract_status: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  billing_frequency: string | null;
  billing_timing: string | null;
  proration_method: string | null;
  invoice_grouping: string | null;
  customer_approval_required: number | null;
  price_list: string | null;
  price_list_valid_upto: string | null;
  currency: string | null;
  default_cost_center: string | null;
  billing_notes: string | null;
};

export type ContractServiceRow = {
  service_item: string;
  service_name: string;
  is_eligible: number;
  negotiated_rate: number | null;
  valid_from: string | null;
  valid_upto: string | null;
  open_assignments: number;
  billable_assignments: number;
  in_use: boolean;
  rate_versions: number;
  covered_by_contract: string | null;
};

export type ContractReadiness = {
  billable_assignments: number;
  priced_assignments: number;
  coverage: number;
  blockers: string[];
  ready: boolean;
  price_list_valid_upto: string | null;
};

export type ContractDetail = {
  customer: string;
  profile: ContractProfile | null;
  price_list: string | null;
  currency: string | null;
  services: ContractServiceRow[];
  readiness: ContractReadiness;
};

export const getContractOptions = (signal?: AbortSignal) =>
  get<ContractOptions>(`${BASE}.get_contract_options`, undefined, signal);

export const listContracts = (signal?: AbortSignal) =>
  get<ContractRow[]>(`${BASE}.list_contracts`, undefined, signal);

export const getContract = (customer: string, signal?: AbortSignal) =>
  get<ContractDetail>(`${BASE}.get_contract`, { customer }, signal);

export const saveContract = (payload: {
  customer: string;
  profile: Partial<ContractProfile>;
  services: Partial<ContractServiceRow>[];
}) =>
  post<ContractDetail>(`${BASE}.save_contract`, {
    customer: payload.customer,
    profile: JSON.stringify(payload.profile),
    services: JSON.stringify(payload.services),
  });

export type BillingRunRow = {
  name: string;
  customer: string;
  contract: string | null;
  status: string;
  billing_period_start: string;
  billing_period_end: string;
  currency: string | null;
  total_amount: number;
  exception_count: number;
  sales_invoice: string | null;
  adjustment_of: string | null;
  credit_note_of: string | null;
  disputed: number;
  creation: string;
  line_count: number;
};

export type BillingRunLine = {
  idx: number;
  service_assignment: string;
  service_item: string;
  service_name: string;
  assignment_scope: string;
  client_user: string | null;
  user_name: string | null;
  hostname: string | null;
  department: string | null;
  user_status: string | null;
  device_type: string | null;
  billed_to: string | null;
  operational_status: string | null;
  effective_start_date: string | null;
  last_billed_on: string | null;
  email: string | null;
  quantity: number;
  billable_days: number;
  period_days: number;
  billable_months: number;
  covered_from: string | null;
  covered_to: string | null;
  gross_amount: number;
  discount_percent: number;
  discount_source: string | null;
  unit_rate: number | null;
  price_source: string;
  proration_method: string;
  amount: number;
  exception_code: string | null;
  exception_detail: string | null;
  line_comment: string | null;
};

export type BillingRunDetail = {
  name: string;
  customer: string;
  contract: string | null;
  contract_title: string | null;
  period_label: string;
  status: string;
  docstatus: number;
  billing_period_start: string;
  billing_period_end: string;
  cutoff_datetime: string | null;
  currency: string | null;
  total_amount: number;
  exception_count: number;
  prepared_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  sales_order: string | null;
  sales_invoice: string | null;
  invoice_status: string | null;
  invoice_submitted: boolean;
  adjustment_of: string | null;
  credit_note_of: string | null;
  credit_note_reason: string | null;
  disputed: boolean;
  dispute_reason: string | null;
  disputed_on: string | null;
  dispute_request: string | null;
  can_resolve_dispute: boolean;
  can_discount_lines: boolean;
  discount_percent: number;
  is_credit_note: boolean;
  lines: BillingRunLine[];
  can_approve: boolean;
  can_revalidate: boolean;
  can_invoice: boolean;
  can_cancel: boolean;
  can_submit_invoice: boolean;
  can_contest: boolean;
  can_discard_invoice: boolean;
  can_reopen: boolean;
};

export type BillingFilters = {
  statuses?: string[];
  billed_to?: string[];
  services?: string[];
  device_types?: string[];
  departments?: string[];
  user_statuses?: string[];
  started_after?: string;
  started_before?: string;
  last_billed_after?: string;
  last_billed_before?: string;
  only_billable?: number;
  search?: string;
};

export type BillingFilterOptions = {
  statuses: string[];
  billed_to: string[];
  user_statuses: string[];
  services: { value: string; label: string }[];
  device_types: string[];
  departments: string[];
};

export type BillingPreview = {
  contract: string;
  contract_title: string | null;
  customer: string;
  matched: number;
  available: number;
  period_start: string;
  period_end: string;
  currency: string | null;
  proration_method: string | null;
  billing_frequency: string | null;
  lines: BillingRunLine[];
  line_count: number;
  billable_count: number;
  exception_count: number;
  exceptions_by_code: Record<string, number>;
  blocked_count: number;
  blocked_by_code: Record<string, number>;
  total_amount: number;
  total_months: number;
};

export const previewBillingRun = (payload: {
  contract: string;
  period_start: string;
  period_end: string;
  adjustment_of?: string;
  filters?: BillingFilters;
  discount_percent?: number;
}) =>
  post<BillingPreview>(`${BASE}.preview_billing_run`, {
    ...payload,
    filters: payload.filters ? JSON.stringify(payload.filters) : undefined,
  });

export const getBillingFilterOptions = (customer: string, signal?: AbortSignal) =>
  get<BillingFilterOptions>(`${BASE}.get_billing_filter_options`, { customer }, signal);

export const generateBillingRun = (payload: {
  contract: string;
  period_start: string;
  period_end: string;
  adjustment_of?: string;
  include?: string[];
  discount_percent?: number;
}) =>
  post<BillingRunDetail>(`${BASE}.generate_billing_run`, {
    ...payload,
    include: payload.include ? JSON.stringify(payload.include) : undefined,
  });

export type BillingRunQuery = {
  customers?: string[];
  statuses?: string[];
  contract?: string;
  period_from?: string;
  period_to?: string;
  search?: string;
  start?: number;
  page_length?: number;
};

export const listBillingRuns = (params: BillingRunQuery = {}, signal?: AbortSignal) =>
  get<{ rows: BillingRunRow[]; total: number }>(
    `${BASE}.list_billing_runs`,
    {
      ...params,
      customers: params.customers?.length ? JSON.stringify(params.customers) : undefined,
      statuses: params.statuses?.length ? JSON.stringify(params.statuses) : undefined,
    },
    signal
  );

export type BillingPeriodStatus = {
  customer: string;
  eligible: number;
  already_billed: number;
  remaining: number;
  fully_billed: boolean;
  runs: string[];
};

export type InvoiceDimensionValue = { fieldname: string; label: string; value: string | null };

export type InvoiceViewItem = {
  idx: number;
  item_code: string;
  item_name: string;
  description: string | null;
  qty: number;
  uom: string | null;
  rate: number;
  price_list_rate: number;
  discount_percentage: number;
  amount: number;
  income_account: string | null;
  billed_count: number | null;
  dimensions: InvoiceDimensionValue[];
  targets: {
    user_name: string | null;
    hostname: string | null;
    serial_number: string | null;
    covered_from: string | null;
    covered_to: string | null;
    months: number;
    amount: number;
  }[];
};

export type InvoiceView = {
  run: string;
  contract?: string | null;
  contract_title?: string | null;
  period_label?: string;
  invoice: {
    name: string;
    status: string;
    docstatus: number;
    company: string;
    customer: string;
    customer_name: string | null;
    posting_date: string;
    due_date: string | null;
    payment_terms_template: string | null;
    currency: string;
    conversion_rate: number;
    debit_to: string | null;
    net_total: number;
    total_taxes_and_charges: number;
    grand_total: number;
    outstanding_amount: number;
    is_return: boolean;
    return_against: string | null;
  } | null;
  dimensions?: InvoiceDimensionValue[];
  items?: InvoiceViewItem[];
  taxes?: { description: string; rate: number; tax_amount: number }[];
};

export const getBillingInvoice = (name: string, signal?: AbortSignal) =>
  get<InvoiceView>(`${BASE}.get_billing_invoice`, { name }, signal);

export const getBillingPeriodStatus = (
  params: { contract: string; period_start: string; period_end: string },
  signal?: AbortSignal
) => get<BillingPeriodStatus>(`${BASE}.billing_period_status`, params, signal);

export const getBillingRun = (name: string, signal?: AbortSignal) =>
  get<BillingRunDetail>(`${BASE}.get_billing_run`, { name }, signal);

const BILLING_ENDPOINTS: Record<string, string> = {
  finalise: `${BASE}.finalise_billing_run`,
  submit_invoice: `${BASE}.submit_invoice_billing_run`,
  discard_invoice: `${BASE}.discard_billing_invoice`,
  reopen: `${BASE}.reopen_billing_run`,
  resolve_dispute: `${BASE}.resolve_billing_dispute`,
};

export type InvoiceDimension = {
  fieldname: string;
  label: string;
  document_type: string | null;
  mandatory: boolean;
  default: string | null;
  options: string[];
};

export type ExchangePreview = {
  needed: boolean;
  currency: string | null;
  company_currency: string | null;
  company?: string;
  rate?: number | null;
};

export const getExchangePreview = (name: string, signal?: AbortSignal) =>
  get<ExchangePreview>(`${BASE}.get_exchange_preview`, { name }, signal);

export const getInvoiceDimensions = (signal?: AbortSignal) =>
  get<InvoiceDimension[]>(`${BASE}.get_invoice_dimensions`, undefined, signal);

export const createCostCenter = (cost_center_name: string) =>
  post<{ name: string; cost_center_name: string }>(`${BASE}.create_cost_center`, {
    cost_center_name,
  });

export const runBillingAction = (action: string, name: string, extra?: Record<string, unknown>) =>
  post<BillingRunDetail>(BILLING_ENDPOINTS[action] ?? `${BASE}.${action}_billing_run`, {
    name,
    ...extra,
  });

export const addUserDevice = (payload: {
  client_user: string;
  hostname: string;
  device_type?: string;
  serial_number?: string;
  assigned_date?: string;
  interfaces?: DeviceInterface[];
  source_request?: string;
}) =>
  post<UserDetail>(`${BASE}.add_user_device`, {
    ...payload,
    interfaces: payload.interfaces ? JSON.stringify(payload.interfaces) : undefined,
  });

export const createClientUser = (payload: {
  customer?: string;
  full_name: string;
  department?: string;
  email?: string;
  username?: string;
  start_date?: string;
  source_request?: string;
  request_line?: number;
}) =>
  post<{ name: string; full_name: string; customer: string }>(
    `${BASE}.create_client_user`,
    payload
  );

export type DeviceFilterOptions = {
  customers: string[];
  device_types: string[];
  statuses: string[];
  coverage: string[];
};

export type DeviceStats = {
  active_devices: number;
  unprotected_devices: number;
  unassigned_devices: number;
  devices_without_mac: number;
};

export type DeviceRow = {
  name: string;
  hostname: string;
  device_type: string;
  status: string;
  assigned_date: string | null;
  serial_number: string | null;
  customer: string;
  assigned_client_user: string | null;
  user_name: string | null;
  user_department: string | null;
  user_status: string | null;
  active_services: number;
  inactive_services: number;
  protected: number;
  interfaces?: DeviceInterface[];
};

export type DeviceContext = {
  device: {
    name: string;
    hostname: string;
    device_type: string;
    status: string;
    customer: string;
    assigned_client_user: string | null;
  };
  user_name: string | null;
  catalogue: { name: string; item_name: string; scope: string; already_open: boolean }[];
  customer_requests: CustomerRequestRef[];
};

export type DeviceListParams = {
  search?: string;
  customer?: string;
  status?: string;
  device_type?: string;
  coverage?: string;
  start?: number;
  page_length?: number;
};

export const getDeviceFilterOptions = (signal?: AbortSignal) =>
  get<DeviceFilterOptions>(`${BASE}.get_device_filter_options`, undefined, signal);

export const getDeviceStats = (params: DeviceListParams = {}, signal?: AbortSignal) =>
  get<DeviceStats>(`${BASE}.get_device_stats`, params, signal);

export const listManagedDevices = (params: DeviceListParams = {}, signal?: AbortSignal) =>
  get<Paginated<DeviceRow>>(`${BASE}.list_devices`, params, signal);

export const getDeviceContext = (device: string, signal?: AbortSignal) =>
  get<DeviceContext>(`${BASE}.get_device_context`, { device }, signal);

export const assignDeviceService = (payload: {
  device: string;
  service_item: string;
  effective_date?: string;
  notes?: string;
  source_request?: string;
}) => post<DeviceContext>(`${BASE}.assign_device_service`, payload);

export const updateManagedDevice = (payload: {
  device: string;
  hostname?: string;
  device_type?: string;
  serial_number?: string;
  assigned_date?: string;
  interfaces?: DeviceInterface[];
  remarks?: string;
}) =>
  post<{ name: string; hostname: string }>(`${BASE}.update_managed_device`, {
    ...payload,
    interfaces: payload.interfaces ? JSON.stringify(payload.interfaces) : undefined,
  });

export type CustomerDevice = {
  name: string;
  hostname: string;
  device_type: string | null;
  status: string;
  serial_number: string | null;
  assigned_client_user: string | null;
  assigned_date: string | null;
  holder_name: string | null;
  holder_status: string | null;
  holder_department: string | null;
  held_since: string | null;
  open_services: number;
  interfaces: DeviceInterface[];
};

export const listCustomerDevices = (
  params: { customer: string; exclude_holder?: string },
  signal?: AbortSignal
) => get<CustomerDevice[]>(`${BASE}.list_customer_devices`, params, signal);

export type HostnameMatch = {
  name: string;
  hostname: string;
  customer: string;
  same_customer: boolean;
  status: string;
  device_type: string | null;
  assigned_client_user: string | null;
  assigned_date: string | null;
  holder_name?: string | null;
  holder_status?: string | null;
  holder_department?: string | null;
  held_since: string | null;
};

export const findDeviceHostname = (
  params: { customer: string; hostname: string },
  signal?: AbortSignal
) => get<HostnameMatch | null>(`${BASE}.find_device_hostname`, params, signal);

export type SerialMatch = {
  name: string;
  hostname: string;
  customer: string;
  status: string;
  assigned_client_user: string | null;
  holder_name?: string | null;
};

export const findDeviceSerial = (
  params: { serial_number: string; exclude?: string },
  signal?: AbortSignal
) => get<SerialMatch | null>(`${BASE}.find_device_serial`, params, signal);

export const handOverDevice = (payload: {
  device: string;
  client_user?: string;
  on_date: string;
  note?: string;
}) => post<DeviceContext>(`${BASE}.hand_over_device`, payload);

export const changeDeviceStatus = (payload: {
  device: string;
  action: 'Retire' | 'Reinstate';
  status?: string;
  effective_date?: string;
  assigned_client_user?: string;
  notes?: string;
}) =>
  post<{ name: string; hostname: string; status: string; closed_assignments: string[] }>(
    `${BASE}.change_device_status`,
    payload
  );

export type CustomerUserRef = { name: string; full_name: string; department: string | null };

export const listCustomerUsers = (customer: string, signal?: AbortSignal) =>
  get<CustomerUserRef[]>(`${BASE}.list_customer_users`, { customer }, signal);

export const createManagedDevice = (payload: {
  customer: string;
  hostname: string;
  device_type?: string;
  serial_number?: string;
  assigned_client_user?: string;
  assigned_date?: string;
  interfaces?: DeviceInterface[];
  source_request?: string;
}) =>
  post<{ name: string; hostname: string; customer: string }>(`${BASE}.create_managed_device`, {
    ...payload,
    interfaces: payload.interfaces ? JSON.stringify(payload.interfaces) : undefined,
  });

export type InternalKpiName =
  | 'reclaimable_licences'
  | 'unprotected_devices'
  | 'billable_services'
  | 'services_added'
  | 'services_removed';

export type InternalKpiRows = {
  kpi: InternalKpiName;
  title: string;
  description: string;
  columns: { key: string; label: string }[];
  rows: ({ name: string } & Record<string, string | number | null>)[];
  start: number;
  page_length: number;
  total: number;
  has_more: boolean;
};

export const listDashboardKpiRows = (
  params: { kpi: InternalKpiName; start?: number; page_length?: number },
  signal?: AbortSignal
) => get<InternalKpiRows>(`${BASE}.list_dashboard_kpi_rows`, params, signal);

export type CatalogueOptions = {
  scopes: string[];
  uoms: string[];
  external_systems: string[];
};

export type CatalogueRow = {
  name: string;
  item_name: string;
  disabled: number;
  stock_uom: string;
  scope: string | null;
  description: string | null;
  open_assignments: number;
  customers: number;
  priced_contracts: number;
  invoice_label: string | null;
};

export type ServiceDetail = {
  service: {
    name: string;
    item_name: string;
    invoice_label: string | null;
    scope: string | null;
    description: string | null;
    uom: string | null;
    disabled: number;
  };
  customers: {
    customer: string;
    open_assignments: number;
    billable_assignments: number;
    current_rate: number | null;
    discount_percent: number | null;
  }[];
  contracts: {
    name: string;
    title: string | null;
    customer: string;
    status: string;
    billing_frequency: string;
  }[];
  billed: { runs: number | null; months: number | null; amount: number | null };
  scopes: string[];
};

export const getService = (name: string, signal?: AbortSignal) =>
  get<ServiceDetail>(`${BASE}.get_service`, { name }, signal);

export const getCatalogueOptions = (signal?: AbortSignal) =>
  get<CatalogueOptions>(`${BASE}.get_catalogue_options`, undefined, signal);

export type ServiceListParams = { search?: string; scope?: string; status?: string };

export const listServices = (params: ServiceListParams = {}, signal?: AbortSignal) =>
  get<CatalogueRow[]>(`${BASE}.list_services`, params, signal);

export const exportServices = (params: ServiceListParams = {}) =>
  exportSheet('export_services', params as Record<string, unknown>, 'services.xlsx');

export const saveService = (payload: {
  name?: string;
  item_code?: string;
  item_name: string;
  scope?: string;
  description?: string;
  uom?: string;
  disabled?: number;
  invoice_label?: string;
}) => post<{ name: string; item_name: string; scope: string }>(`${BASE}.save_service`, payload);

export type ContractRate = {
  name: string;
  item_code: string;
  item_name: string | null;
  price_list_rate: number;
  currency: string | null;
  valid_from: string | null;
  valid_upto: string | null;
  note: string | null;
  msp_discount_percent: number;
  state: 'Active' | 'Scheduled' | 'Expired';
};

export const listContractRates = (customer: string, signal?: AbortSignal) =>
  get<ContractRate[]>(`${BASE}.list_contract_rates`, { customer }, signal);

export const saveContractRate = (payload: {
  customer: string;
  service_item: string;
  rate: number;
  valid_from?: string;
  valid_upto?: string;
  note?: string;
  name?: string;
  discount_percent?: number;
}) => post<{ name: string; item_code: string; rate: number }>(`${BASE}.save_contract_rate`, payload);

export const deleteContractRate = (name: string) =>
  post<{ deleted: string }>(`${BASE}.delete_contract_rate`, { name });

export const setServiceEligibility = (payload: {
  customer: string;
  service_item: string;
  is_eligible: number;
}) => post<ContractDetail>(`${BASE}.set_service_eligibility`, payload);

export type MspContractService = {
  service_item: string;
  service_name: string;
  notes: string | null;
  rate?: number | null;
  valid_from?: string | null;
  valid_upto?: string | null;
};

export type MspContract = {
  name: string;
  customer: string;
  title: string | null;
  status: string;
  start_date: string;
  end_date: string | null;
  billing_frequency: string;
  billing_timing: string;
  proration_method: string;
  invoice_grouping: string;
  price_list: string;
  price_list_valid_upto: string | null;
  currency: string;
  default_cost_center: string | null;
  billing_notes: string | null;
  service_count?: number;
  run_count?: number;
  services: MspContractService[];
};

export type MspContractDetail = MspContract & {
  blockers: string[];
  runs: {
    name: string;
    status: string;
    billing_period_start: string;
    billing_period_end: string;
    total_amount: number;
    currency: string | null;
    sales_invoice: string | null;
  }[];
};

export type MspContractOptions = {
  statuses: string[];
  billing_frequencies: string[];
  billing_timings: string[];
  proration_methods: string[];
  invoice_groupings: string[];
  price_lists: string[];
  default_price_list: string | null;
  currencies: string[];
  default_currency: string | null;
  services: { value: string; label: string }[];
};

export const getMspContractOptions = (customer?: string, signal?: AbortSignal) =>
  get<MspContractOptions>(`${BASE}.get_msp_contract_options`, { customer }, signal);

export const listMspContracts = (
  params: { customer?: string; status?: string; billable_only?: number } = {},
  signal?: AbortSignal
) => get<MspContract[]>(`${BASE}.list_msp_contracts`, params, signal);

export const getMspContract = (name: string, signal?: AbortSignal) =>
  get<MspContractDetail>(`${BASE}.get_msp_contract`, { name }, signal);

export const saveMspContract = (payload: {
  name?: string;
  contract: Partial<MspContract>;
  services?: { service_item: string; notes?: string | null }[];
}) =>
  post<MspContractDetail>(`${BASE}.save_msp_contract`, {
    name: payload.name,
    contract: JSON.stringify(payload.contract),
    services: payload.services ? JSON.stringify(payload.services) : undefined,
  });

export const setMspContractStatus = (name: string, status: string) =>
  post<MspContractDetail>(`${BASE}.set_msp_contract_status`, { name, status });

export type BreakdownRow = {
  count: number;
  employee_name: string | null;
  email: string | null;
  hostname: string | null;
  company: string;
  department: string | null;
  creation_date: string | null;
  reference: string;
  status: string | null;
  monthly: number;
  months: number;
  total: number;
  comments: string | null;
};

export type BillingBreakdown = {
  run: string;
  customer: string;
  contract: string | null;
  invoice: string | null;
  period_label: string;
  period_start: string;
  period_end: string;
  currency: string | null;
  summary: { company: string; service: string; months: number; amount: number }[];
  blocks: {
    service_name: string;
    service_item: string;
    rows: BreakdownRow[];
    months: number;
    total: number;
  }[];
  total_amount: number;
};

export const getBillingBreakdown = (name: string, signal?: AbortSignal) =>
  get<BillingBreakdown>(`${BASE}.get_billing_breakdown`, { name }, signal);

export const downloadBreakdownFile = (run: string) =>
  download(`${BASE}.download_billing_breakdown`, { name: run }, `${run}-breakdown.xlsx`);

/** The sheet is streamed by the server, and travels through the client like anything else. */
const exportSheet = (method: string, params: Record<string, unknown>, name: string) =>
  download(`${BASE}.${method}`, params, name);

export const exportUsers = (params: UserListParams = {}) =>
  exportSheet('export_users', params as Record<string, unknown>, 'users.xlsx');

export const exportDevices = (params: DeviceListParams = {}) =>
  exportSheet('export_devices', params as Record<string, unknown>, 'devices.xlsx');

export const exportRequests = (params: RequestListParams = {}) =>
  exportSheet('export_requests', params as Record<string, unknown>, 'requests.xlsx');

export const downloadInvoicePdf = (run: string) =>
  download(`${BASE}.download_billing_invoice`, { name: run }, `${run}.pdf`);

export type CreditableLine = BillingRunLine & {
  credited_months: number;
  remaining_months: number;
};

export type CreditableLines = {
  run: string;
  customer: string;
  invoice: string;
  invoice_submitted: boolean;
  period_label: string;
  currency: string | null;
  lines: CreditableLine[];
};

export const getCreditableLines = (name: string, signal?: AbortSignal) =>
  get<CreditableLines>(`${BASE}.get_creditable_lines`, { name }, signal);

export const createCreditNote = (payload: {
  name: string;
  lines: { service_assignment: string; months: number }[];
  reason: string;
}) =>
  post<BillingRunDetail>(`${BASE}.create_credit_note`, {
    name: payload.name,
    lines: JSON.stringify(payload.lines),
    reason: payload.reason,
  });

export type BillingDueRow = {
  contract: string;
  customer: string;
  title: string | null;
  billing_frequency: string;
  start_date: string;
  end_date: string | null;
  covered_upto: string | null;
  next_period_start: string;
  next_period_end: string;
  days_left: number | null;
  state: 'Overdue' | 'Never billed' | 'Due soon' | 'Scheduled';
  billable_assignments: number;
  runs: number;
};

export type BillingDue = {
  as_of: string;
  horizon_days: number;
  rows: BillingDueRow[];
  action_needed: number;
};

export const getBillingDue = (horizonDays = 30, signal?: AbortSignal) =>
  get<BillingDue>(`${BASE}.get_billing_due`, { horizon_days: horizonDays }, signal);

export type CustomerAddress = {
  name?: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string | null;
  phone: string | null;
  email_id: string | null;
};

export type CustomerDetails = {
  name: string;
  customer_name: string | null;
  customer_type: string | null;
  customer_group: string | null;
  territory: string | null;
  tax_id: string | null;
  default_currency: string | null;
  default_price_list: string | null;
  payment_terms: string | null;
  website: string | null;
  msp_free_of_charge: number;
  last_billed_on: string | null;
  address: CustomerAddress | null;
  counts: { users: number; devices: number; contracts: number };
};

export type CustomerOptions = {
  customer_types: string[];
  customer_groups: string[];
  territories: string[];
  countries: string[];
  currencies: string[];
  price_lists: string[];
  payment_terms: string[];
};

export const getCustomerOptions = (signal?: AbortSignal) =>
  get<CustomerOptions>(`${BASE}.get_customer_options`, undefined, signal);

export const getCustomerDetails = (customer: string, signal?: AbortSignal) =>
  get<CustomerDetails>(`${BASE}.get_customer_details`, { customer }, signal);

export const saveCustomerDetails = (payload: {
  customer: string;
  details: Partial<CustomerDetails>;
  address?: Partial<CustomerAddress>;
}) =>
  post<CustomerDetails>(`${BASE}.save_customer_details`, {
    customer: payload.customer,
    details: JSON.stringify(payload.details),
    address: payload.address ? JSON.stringify(payload.address) : undefined,
  });

export const salesInvoiceDeskUrl = (invoice: string) =>
  `/app/sales-invoice/${encodeURIComponent(invoice)}`;

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
  customer: string;
  title: string;
  detail: string;
  link: string | null;
};

export type ActivityOptions = {
  kinds: { value: ActivityKind; label: string }[];
  customers: string[];
};

export type ActivityQuery = {
  customers?: string[];
  kinds?: string[];
  date_from?: string;
  date_to?: string;
  start?: number;
  page_length?: number;
};

export const getActivityOptions = (signal?: AbortSignal) =>
  get<ActivityOptions>(`${BASE}.get_activity_options`, undefined, signal);

export const listActivity = (params: ActivityQuery = {}, signal?: AbortSignal) =>
  get<{
    rows: ActivityEvent[];
    start: number;
    page_length: number;
    total: number;
    has_more: boolean;
    shows_billing: boolean;
  }>(
    `${BASE}.list_activity`,
    {
      ...params,
      customers: params.customers?.length ? JSON.stringify(params.customers) : undefined,
      kinds: params.kinds?.length ? JSON.stringify(params.kinds) : undefined,
    },
    signal
  );

export type RequestActionRow = {
  name: string;
  title: string;
  action_type: string;
  description: string | null;
  enabled: number;
  used: number;
};

export type SettingsOptions = { action_types: string[] };

export const getSettingsOptions = (signal?: AbortSignal) =>
  get<SettingsOptions>(`${BASE}.get_settings_options`, undefined, signal);

export const listRequestActions = (signal?: AbortSignal) =>
  get<RequestActionRow[]>(`${BASE}.list_request_actions`, undefined, signal);

export const saveRequestAction = (payload: {
  name?: string;
  action: Partial<RequestActionRow>;
}) =>
  post<RequestActionRow[]>(`${BASE}.save_request_action`, {
    name: payload.name,
    action: JSON.stringify(payload.action),
  });

export const deleteRequestAction = (name: string) =>
  post<RequestActionRow[]>(`${BASE}.delete_request_action`, { name });

export type InvoiceSettings = {
  issuer_name: string | null;
  issuer_address: string | null;
  issuer_phone: string | null;
  issuer_website: string | null;
  bank_currency: string | null;
  beneficiary: string | null;
  beneficiary_bank: string | null;
  intermediary_bank: string | null;
  footer_note: string | null;
  payment_terms_days: number | null;
  dispute_window_days: number | null;
  default_cost_center: string | null;
  show_cost_center_on_invoice: number;
  portal_url: string | null;
};

export type Approver = {
  user: string;
  full_name: string | null;
  department: string | null;
  can_submit: boolean;
  can_approve: boolean;
};

export type CustomerAuthority = {
  customer: string;
  enabled: boolean;
  approvers: Approver[];
  candidates: { user: string; full_name: string }[];
};

export type AccountRights = {
  user: string;
  customer: string | null;
  is_customer_account: boolean;
  named: boolean;
  department: string | null;
  can_submit: boolean;
  can_approve: boolean;
};

export const getAccountRights = (user: string, signal?: AbortSignal) =>
  get<AccountRights>(`${BASE}.get_account_rights`, { user }, signal);

export const setAccountRights = (user: string, rights: Record<string, unknown>) =>
  post<AccountRights>(`${BASE}.set_account_rights`, { user, rights: JSON.stringify(rights) });

export const getCustomerAuthority = (customer: string, signal?: AbortSignal) =>
  get<CustomerAuthority>(`${BASE}.get_customer_authority`, { customer }, signal);

export const saveCustomerAuthority = (payload: {
  customer: string;
  enabled: number;
  approvers: Approver[];
}) =>
  post<CustomerAuthority>(`${BASE}.save_customer_authority`, {
    ...payload,
    approvers: JSON.stringify(payload.approvers),
  });

export type CustomerMapping = {
  excel_label: string;
  customer_id: string;
  create_as: string | null;
  department_prefix: string | null;
  exists?: boolean;
};

export type ServiceMapping = {
  service_key: string;
  item_id: string;
  scope: string;
  exists?: boolean;
};

export type ImportMappings = {
  customers: CustomerMapping[];
  services: ServiceMapping[];
};

export type ImportReport = {
  dry_run: boolean;
  rows_read: number;
  created: Record<string, number>;
  updated: Record<string, number>;
  skipped: Record<string, number>;
  exceptions: { row: number; name?: string; reason: string }[];
};

export type AssetFileShape = {
  headers: string[];
  recognised: Partial<Record<'hostname' | 'serial_number' | 'username', string>>;
  missing: string[];
};

export type AssetImportReport = {
  dry_run: boolean;
  rows_read: number;
  updated: Record<string, number>;
  skipped: Record<string, number>;
  exceptions: { row: number; reason: string }[];
};

export const describeAssetFile = (file_url: string) =>
  post<AssetFileShape>(`${BASE}.describe_asset_file`, { file_url });

export const runAssetImport = (file_url: string, dry_run: number, fill_blanks_only: number) =>
  post<AssetImportReport>(`${BASE}.run_asset_import`, { file_url, dry_run, fill_blanks_only });

export const getImportMappings = (signal?: AbortSignal) =>
  get<ImportMappings>(`${BASE}.get_import_mappings`, undefined, signal);

export const saveImportMappings = (payload: ImportMappings) =>
  post<ImportMappings>(`${BASE}.save_import_mappings`, {
    customers: JSON.stringify(payload.customers),
    services: JSON.stringify(payload.services),
  });

/** The file goes up as multipart, which the JSON transport cannot carry. */
export const uploadUserList = (file: File) => {
  const body = new FormData();
  body.append('file', file);

  return postForm<{ file_url: string; file_name: string }>(`${BASE}.upload_user_list`, body);
};

export const runUserImport = (file_url: string, dry_run: number, fill_blanks_only: number) =>
  post<ImportReport>(`${BASE}.run_user_import`, { file_url, dry_run, fill_blanks_only });

export type TeamMember = {
  name: string;
  full_name: string | null;
  enabled: number;
  user_type: string;
  last_active: string | null;
  creation: string;
  role: string | null;
  roles: string[];
  kind: string;
  role_label: string | null;
  customers: string[];
  two_factor: boolean;
};

export type SignIn = {
  operation: string;
  status: string;
  ip_address: string | null;
  creation: string;
};

export type TeamMemberDetail = {
  name: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  enabled: number;
  user_type: string;
  creation: string;
  last_active: string | null;
  last_login: string | null;
  last_password_reset_date: string | null;
  kind: string;
  role_label: string | null;
  role: string | null;
  roles: string[];
  desk_access: boolean;
  customers: string[];
  sign_ins: SignIn[];
  two_factor: boolean;
  is_self: boolean;
  can_invite: boolean;
};

export const getTeamMember = (email: string, signal?: AbortSignal) =>
  get<TeamMemberDetail>(`${BASE}.get_team_member`, { email }, signal);

export const listTeam = (
  params: { search?: string; role?: string; status?: string; kind?: string } = {},
  signal?: AbortSignal
) => get<TeamMember[]>(`${BASE}.list_team`, params, signal);

export type RoleChoice = { value: string; label: string };

export type TeamOptions = {
  internal_roles: RoleChoice[];
  customer_roles: RoleChoice[];
  roles: string[];
  labels: Record<string, string>;
  kinds: string[];
  customers: string[];
};

export const getTeamOptions = (signal?: AbortSignal) =>
  get<TeamOptions>(`${BASE}.get_team_options`, undefined, signal);

export const createAccount = (payload: {
  email: string;
  first_name: string;
  last_name?: string;
  kind: 'internal' | 'customer';
  role: string;
  customer?: string;
  send_email?: number;
}) => post<TeamMember>(`${BASE}.create_account`, payload);

export const resendTeamInvitation = (email: string) =>
  post<{ sent_to: string }>(`${BASE}.resend_team_invitation`, { email });

export const setTeamRole = (payload: { email: string; role: string }) =>
  post<TeamMember[]>(`${BASE}.set_team_role`, payload);

export const setTeamEnabled = (payload: { email: string; enabled: number }) =>
  post<TeamMember[]>(`${BASE}.set_team_enabled`, payload);

export const getInvoiceSettings = (signal?: AbortSignal) =>
  get<InvoiceSettings>(`${BASE}.get_invoice_settings`, undefined, signal);

export const saveInvoiceSettings = (settings: Partial<InvoiceSettings>) =>
  post<InvoiceSettings>(`${BASE}.save_invoice_settings`, {
    settings: JSON.stringify(settings),
  });

export const updateClientUser = (payload: {
  name: string;
  full_name?: string;
  department?: string;
  email?: string;
  username?: string;
  start_date?: string;
  remarks?: string;
}) => post<UserDetail>(`${BASE}.update_client_user`, payload);

export const setBillingLineDiscount = (payload: {
  name: string;
  service_assignment: string;
  discount_percent: number;
}) => post<BillingRunDetail>(`${BASE}.set_billing_line_discount`, payload);


