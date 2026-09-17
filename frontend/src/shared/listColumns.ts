/**
 * Which columns each list may show. The same picker as the exports reads these, with a limit:
 * a table only has room for so many columns before it stops reading as one. The row actions
 * are always there and do not count.
 */
import type { ExportCatalogue } from './exportColumns';

export const LIST_LIMIT = 6;

export const INTERNAL_DEVICE_LIST: ExportCatalogue = {
  id: 'listing:internal:devices',
  limit: LIST_LIMIT,
  columns: [
    { key: 'device', label: 'Device', section: 'Identity', required: true },
    { key: 'device_type', label: 'Type', section: 'Identity' },
    { key: 'customer', label: 'Customer', section: 'Identity' },
    { key: 'held_by', label: 'Held by', section: 'Holder' },
    { key: 'user_department', label: 'Department', section: 'Holder' },
    { key: 'status', label: 'Status', section: 'Lifecycle' },
    { key: 'assigned_date', label: 'In service since', section: 'Lifecycle' },
    { key: 'retired_date', label: 'Retired on', section: 'Lifecycle' },
    { key: 'interfaces', label: 'Network interfaces', section: 'Hardware' },
    { key: 'manufacturer', label: 'Manufacturer', section: 'Hardware' },
    { key: 'model', label: 'Model', section: 'Hardware' },
    { key: 'operating_system', label: 'Operating system', section: 'Hardware' },
    { key: 'active_services', label: 'Active services', section: 'Services' },
    { key: 'inactive_services', label: 'Inactive services', section: 'Services' },
    { key: 'services', label: 'Services', section: 'Services' },
    { key: 'last_billed_on', label: 'Last billed on', section: 'Billing' },
    { key: 'covered_until', label: 'Billed up to', section: 'Billing' },
  ],
  defaults: ['device', 'device_type', 'customer', 'held_by', 'status', 'active_services'],
};

export const INTERNAL_USER_LIST: ExportCatalogue = {
  id: 'listing:internal:users',
  limit: LIST_LIMIT,
  columns: [
    { key: 'user', label: 'User', section: 'Identity', required: true },
    { key: 'username', label: 'Username', section: 'Identity' },
    { key: 'department', label: 'Department', section: 'Identity' },
    { key: 'customer', label: 'Customer', section: 'Identity' },
    { key: 'status', label: 'Status', section: 'Lifecycle' },
    { key: 'start_date', label: 'In service since', section: 'Lifecycle' },
    { key: 'disabled_date', label: 'Disabled on', section: 'Lifecycle' },
    { key: 'open_requests', label: 'Open requests', section: 'Lifecycle' },
    { key: 'devices', label: 'Devices', section: 'Devices' },
    { key: 'serial_numbers', label: 'Serial numbers', section: 'Devices' },
    { key: 'current_devices', label: 'Devices held', section: 'Devices' },
    { key: 'active_services', label: 'Active services', section: 'Services' },
    { key: 'inactive_services', label: 'Inactive services', section: 'Services' },
    { key: 'personal_services', label: 'Personal services', section: 'Services' },
    { key: 'device_services', label: 'Device services', section: 'Services' },
    { key: 'services', label: 'Services', section: 'Services' },
    { key: 'last_billed_on', label: 'Last billed on', section: 'Billing' },
    { key: 'covered_until', label: 'Billed up to', section: 'Billing' },
  ],
  defaults: ['user', 'department', 'status', 'devices', 'active_services', 'inactive_services'],
};

export const INTERNAL_REQUEST_LIST: ExportCatalogue = {
  id: 'listing:internal:requests',
  limit: LIST_LIMIT,
  columns: [
    { key: 'request', label: 'Request', section: 'Identity', required: true },
    { key: 'users', label: 'Users', section: 'Identity' },
    { key: 'customer', label: 'Customer', section: 'Identity' },
    { key: 'request_type', label: 'Type', section: 'Identity' },
    { key: 'requester', label: 'Raised by', section: 'Identity' },
    { key: 'status', label: 'Status', section: 'Progress' },
    { key: 'priority', label: 'Priority', section: 'Progress' },
    { key: 'lines', label: 'Lines', section: 'Progress' },
    { key: 'source', label: 'Source', section: 'Progress' },
    { key: 'creation', label: 'Raised', section: 'Dates' },
    { key: 'age', label: 'Age', section: 'Dates' },
    { key: 'modified', label: 'Last updated', section: 'Dates' },
  ],
  defaults: ['request', 'users', 'customer', 'request_type', 'status', 'priority'],
};

export const INTERNAL_SERVICE_LIST: ExportCatalogue = {
  id: 'listing:internal:services',
  limit: LIST_LIMIT,
  columns: [
    { key: 'service', label: 'Service', section: 'Identity', required: true },
    { key: 'scope', label: 'Billed per', section: 'Identity' },
    { key: 'stock_uom', label: 'Unit', section: 'Identity' },
    { key: 'invoice_label', label: 'Invoice label', section: 'Identity' },
    { key: 'open_assignments', label: 'Open assignments', section: 'Usage' },
    { key: 'customers', label: 'Customers', section: 'Usage' },
    { key: 'status', label: 'Status', section: 'Usage' },
    { key: 'priced_contracts', label: 'Priced contracts', section: 'Billing' },
    { key: 'description', label: 'Description', section: 'Notes' },
  ],
  defaults: ['service', 'scope', 'open_assignments', 'customers', 'status', 'priced_contracts'],
};

export const PORTAL_DEVICE_LIST: ExportCatalogue = {
  id: 'listing:portal:devices',
  limit: LIST_LIMIT,
  columns: INTERNAL_DEVICE_LIST.columns.filter((column) => column.key !== 'customer'),
  defaults: ['device', 'device_type', 'held_by', 'status', 'active_services', 'inactive_services'],
};

export const PORTAL_USER_LIST: ExportCatalogue = {
  id: 'listing:portal:users',
  limit: LIST_LIMIT,
  columns: INTERNAL_USER_LIST.columns.filter((column) => column.key !== 'customer'),
  defaults: ['user', 'department', 'status', 'devices', 'active_services', 'inactive_services'],
};
