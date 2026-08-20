import { get, post } from './client';

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
  service_assignments: number;
  active_services: number;
  open_requests: number;
  awaiting_approval: number;
  reclaimable_licences: number;
  unprotected_devices: number;
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
  is_new_user?: number;
  new_user_full_name?: string | null;
  new_user_department?: string | null;
  new_user_email?: string | null;
  client_user: string | null;
  managed_device: string | null;
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
  start?: number;
  page_length?: number;
};

export type NewRequestLine = {
  action: string;
  target_scope: string;
  is_new_user?: number;
  client_user?: string;
  new_user_full_name?: string;
  new_user_department?: string;
  new_user_email?: string;
  is_new_device?: number;
  new_device_label?: string;
  managed_device?: string;
  customer_site?: string;
  requested_service: string;
  requested_quantity?: number;
  requested_effective_date?: string;
  comment?: string;
};

export const getContext = (signal?: AbortSignal) =>
  get<PortalContext>(`${BASE}.get_context`, undefined, signal);

export const getSummary = (customer?: string, signal?: AbortSignal) =>
  get<PortalSummary>(`${BASE}.get_summary`, { customer }, signal);

export const listClientUsers = (params: ListParams = {}, signal?: AbortSignal) =>
  get<Paginated<ClientUser>>(`${BASE}.list_client_users`, params, signal);

export const listDevices = (params: ListParams = {}, signal?: AbortSignal) =>
  get<Paginated<ManagedDevice>>(`${BASE}.list_devices`, params, signal);

export const listServiceAssignments = (
  params: ListParams & { client_user?: string } = {},
  signal?: AbortSignal
) => get<Paginated<ServiceAssignment>>(`${BASE}.list_service_assignments`, params, signal);

export const listRequests = (params: ListParams = {}, signal?: AbortSignal) =>
  get<Paginated<ServiceRequest>>(`${BASE}.list_requests`, params, signal);

export type PortalRequestLine = {
  idx: number;
  action: string;
  line_status: string;
  rejection_reason: string | null;
  is_new_user: number;
  new_user_full_name: string | null;
  new_user_department: string | null;
  is_new_device: number;
  new_device_label: string | null;
  user_name: string | null;
  department: string | null;
  service_name: string;
  hostname: string | null;
  requested_effective_date: string | null;
  comment: string | null;
  service_status: string | null;
  service_start_date: string | null;
  delivered_on: string | null;
};

export type PortalRequestDetail = {
  name: string;
  customer: string;
  request_type: string;
  status: string;
  priority: string;
  source: string;
  creation: string;
  modified: string;
  rejection_reason: string | null;
  reviewed_on: string | null;
  lines: PortalRequestLine[];
};

export type PortalUserDevice = {
  hostname: string;
  device_type: string;
  status: string;
  assigned_date: string | null;
};

export type PortalUserService = {
  service_name: string;
  hostname: string | null;
  operational_status: string;
  effective_start_date: string | null;
  effective_end_date: string | null;
  customer_visible_notes: string | null;
  source_request: string | null;
  last_billed_on: string | null;
};

export type PortalUserDetail = {
  user: {
    name: string;
    full_name: string;
    department: string | null;
    customer: string;
    lifecycle_status: string;
    start_date: string | null;
    disabled_date: string | null;
  };
  devices: PortalUserDevice[];
  services: PortalUserService[];
  requests: {
    name: string;
    status: string;
    priority: string;
    request_type: string;
    creation: string;
  }[];
};

export const getRequest = (name: string, signal?: AbortSignal) =>
  get<PortalRequestDetail>(`${BASE}.get_request`, { name }, signal);

export const getUserDetail = (clientUser: string, signal?: AbortSignal) =>
  get<PortalUserDetail>(`${BASE}.get_user_detail`, { client_user: clientUser }, signal);

export const listCatalogue = (customer?: string, signal?: AbortSignal) =>
  get<{ items: CatalogueItem[]; count: number }>(`${BASE}.list_catalogue`, { customer }, signal);

export const createRequest = (payload: {
  customer?: string;
  request_type?: string;
  priority?: string;
  lines: NewRequestLine[];
}) => post<ServiceRequestDetail>(`${BASE}.create_request`, payload);

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
  | 'unprotected_devices';

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
};

export const listBilling = (customer?: string, signal?: AbortSignal) =>
  get<PortalBillingRow[]>(`${BASE}.list_billing`, { customer }, signal);

export const getBillingDetail = (name: string, signal?: AbortSignal) =>
  get<PortalBillingDetail>(`${BASE}.get_billing_detail`, { name }, signal);

export const invoiceDownloadUrl = (name: string) =>
  `/api/method/${BASE}.download_invoice?name=${encodeURIComponent(name)}`;

export const breakdownDownloadUrl = (name: string) =>
  `/api/method/${BASE}.download_breakdown?name=${encodeURIComponent(name)}`;
