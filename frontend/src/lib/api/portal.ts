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
  target_scope: string;
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
};

export type ListParams = {
  customer?: string;
  search?: string;
  status?: string;
  start?: number;
  page_length?: number;
};

export type NewRequestLine = {
  target_scope: string;
  client_user?: string;
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

export const getRequest = (name: string, signal?: AbortSignal) =>
  get<ServiceRequestDetail>(`${BASE}.get_request`, { name }, signal);

export const listCatalogue = (customer?: string, signal?: AbortSignal) =>
  get<{ items: CatalogueItem[]; count: number }>(`${BASE}.list_catalogue`, { customer }, signal);

export const createRequest = (payload: {
  customer?: string;
  request_type: string;
  priority?: string;
  lines: NewRequestLine[];
}) => post<ServiceRequestDetail>(`${BASE}.create_request`, payload);
