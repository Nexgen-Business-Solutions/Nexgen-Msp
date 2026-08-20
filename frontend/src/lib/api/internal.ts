import { get, post } from './client';
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
  line_status: string;
  rejection_reason: string | null;
};

export type RequestDetail = {
  name: string;
  customer: string;
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

export const getRequestStats = (signal?: AbortSignal) =>
  get<RequestStats>(`${BASE}.get_request_stats`, undefined, signal);

export const listRequests = (params: RequestListParams = {}, signal?: AbortSignal) =>
  get<Paginated<RequestRow>>(`${BASE}.list_requests`, params, signal);

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
  department: string | null;
  customer: string;
  lifecycle_status: string;
  start_date: string | null;
  disabled_date: string | null;
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

export type UserDetail = {
  user: {
    name: string;
    full_name: string;
    department: string | null;
    customer: string;
    email: string | null;
    lifecycle_status: string;
    start_date: string | null;
    disabled_date: string | null;
    portal_user: string | null;
    remarks: string | null;
  };
  devices: UserDevice[];
  services: UserServiceRow[];
  requests: { name: string; status: string; priority: string; request_type: string; creation: string }[];
  customer_requests: CustomerRequestRef[];
  device_types: string[];
  interface_types: string[];
  catalogue: { name: string; item_name: string; scope: string }[];
};

export type UserListParams = {
  search?: string;
  customer?: string;
  status?: string;
  department?: string;
  service?: string;
  coverage?: string;
  start?: number;
  page_length?: number;
};

export const getUserFilterOptions = (signal?: AbortSignal) =>
  get<UserFilterOptions>(`${BASE}.get_user_filter_options`, undefined, signal);

export const getUserStats = (signal?: AbortSignal) =>
  get<UserStats>(`${BASE}.get_user_stats`, undefined, signal);

export const listUsers = (params: UserListParams = {}, signal?: AbortSignal) =>
  get<Paginated<UserRow>>(`${BASE}.list_users`, params, signal);

export const getUser = (name: string, signal?: AbortSignal) =>
  get<UserDetail>(`${BASE}.get_user`, { name }, signal);

export const assignUserService = (payload: {
  client_user: string;
  service_item: string;
  effective_date?: string;
  device_mode?: 'existing' | 'new' | 'none';
  managed_device?: string;
  hostname?: string;
  device_type?: string;
  interfaces?: DeviceInterface[];
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
  profile: string | null;
  contract_status: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  proration_method: string | null;
  billing_timing: string | null;
  currency: string | null;
  price_list_valid_upto: string | null;
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
  email: string | null;
  quantity: number;
  billable_days: number;
  period_days: number;
  billable_months: number;
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
  sales_invoice: string | null;
  invoice_status: string | null;
  invoice_submitted: boolean;
  adjustment_of: string | null;
  credit_note_of: string | null;
  credit_note_reason: string | null;
  is_credit_note: boolean;
  lines: BillingRunLine[];
  can_approve: boolean;
  can_revalidate: boolean;
  can_invoice: boolean;
  can_cancel: boolean;
  can_submit_invoice: boolean;
  can_issue_credit_note: boolean;
  can_contest: boolean;
  can_discard_invoice: boolean;
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
  total_amount: number;
  total_months: number;
};

export const previewBillingRun = (payload: {
  contract: string;
  period_start: string;
  period_end: string;
  adjustment_of?: string;
  filters?: BillingFilters;
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
}) =>
  post<BillingRunDetail>(`${BASE}.generate_billing_run`, {
    ...payload,
    include: payload.include ? JSON.stringify(payload.include) : undefined,
  });

export const listBillingRuns = (
  params: { customer?: string; status?: string; start?: number; page_length?: number } = {},
  signal?: AbortSignal
) => get<{ rows: BillingRunRow[]; total: number }>(`${BASE}.list_billing_runs`, params, signal);

export const getBillingRun = (name: string, signal?: AbortSignal) =>
  get<BillingRunDetail>(`${BASE}.get_billing_run`, { name }, signal);

const BILLING_ENDPOINTS: Record<string, string> = {
  submit_invoice: `${BASE}.submit_invoice_billing_run`,
  issue_credit_note: `${BASE}.issue_credit_note`,
  discard_invoice: `${BASE}.discard_billing_invoice`,
};

export const runBillingAction = (action: string, name: string) =>
  post<BillingRunDetail>(BILLING_ENDPOINTS[action] ?? `${BASE}.${action}_billing_run`, { name });

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

export const getDeviceStats = (signal?: AbortSignal) =>
  get<DeviceStats>(`${BASE}.get_device_stats`, undefined, signal);

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
  assigned_client_user?: string;
  assigned_date?: string;
  interfaces?: DeviceInterface[];
  remarks?: string;
}) =>
  post<{ name: string; hostname: string }>(`${BASE}.update_managed_device`, {
    ...payload,
    interfaces: payload.interfaces ? JSON.stringify(payload.interfaces) : undefined,
  });

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
};

export const getCatalogueOptions = (signal?: AbortSignal) =>
  get<CatalogueOptions>(`${BASE}.get_catalogue_options`, undefined, signal);

export const listServices = (signal?: AbortSignal) =>
  get<CatalogueRow[]>(`${BASE}.list_services`, undefined, signal);

export const saveService = (payload: {
  name?: string;
  item_code?: string;
  item_name: string;
  scope?: string;
  description?: string;
  uom?: string;
  disabled?: number;
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
  currencies: string[];
  services: { value: string; label: string }[];
};

export const getMspContractOptions = (signal?: AbortSignal) =>
  get<MspContractOptions>(`${BASE}.get_msp_contract_options`, undefined, signal);

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

export const breakdownFileUrl = (run: string) =>
  `/api/method/${BASE}.download_billing_breakdown?name=${encodeURIComponent(run)}`;

export const invoicePdfUrl = (run: string) =>
  `/api/method/${BASE}.download_billing_invoice?name=${encodeURIComponent(run)}`;

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

export const issueCreditNote = (name: string) =>
  post<BillingRunDetail>(`${BASE}.issue_credit_note`, { name });

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
