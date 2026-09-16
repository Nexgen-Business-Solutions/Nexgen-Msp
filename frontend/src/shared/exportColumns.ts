/**
 * What an export may carry, per listing: the columns on offer, grouped the way they are read,
 * and the few that are always there. What each person picks is kept in their own browser, so
 * the next export comes out the way the last one did.
 *
 * Services are taken away side by side: every service gets its own consecutive columns, and
 * this says which facts about a service those columns hold.
 */

export type ExportColumn = {
  key: string;
  label: string;
  section: string;
  /** always written, never unticked */
  required?: boolean;
};

export type ExportCatalogue = {
  /** what the picker remembers this list as */
  id: string;
  columns: ExportColumn[];
  defaults: string[];
  /** the lists whose rows carry services */
  serviceFields?: ExportColumn[];
  serviceDefaults?: string[];
};

const SERVICE_FIELDS: ExportColumn[] = [
  { key: 'service_name', label: 'Service', section: 'Per service' },
  { key: 'operational_status', label: 'Status', section: 'Per service' },
  { key: 'assignment_scope', label: 'Scope', section: 'Per service' },
  { key: 'hostname', label: 'On machine', section: 'Per service' },
  { key: 'holder_name', label: 'Held by', section: 'Per service' },
  { key: 'effective_start_date', label: 'Since', section: 'Per service' },
  { key: 'effective_end_date', label: 'Ended on', section: 'Per service' },
  { key: 'last_billed_on', label: 'Last billed on', section: 'Per service' },
  { key: 'billing_status', label: 'Billing status', section: 'Per service' },
  { key: 'source_request', label: 'Request', section: 'Per service' },
];

const PERSON_SERVICE_FIELDS = SERVICE_FIELDS.filter((field) => field.key !== 'holder_name');
const DEVICE_SERVICE_FIELDS = SERVICE_FIELDS.filter((field) => field.key !== 'hostname');

export const INTERNAL_USERS: ExportCatalogue = {
  id: 'internal:users',
  columns: [
    { key: 'full_name', label: 'User', section: 'Identity', required: true },
    { key: 'username', label: 'Username', section: 'Identity' },
    { key: 'email', label: 'Email', section: 'Identity' },
    { key: 'department', label: 'Department', section: 'Identity' },
    { key: 'customer', label: 'Customer', section: 'Identity' },
    { key: 'name', label: 'Reference', section: 'Identity' },
    { key: 'lifecycle_status', label: 'Status', section: 'Lifecycle' },
    { key: 'start_date', label: 'In service since', section: 'Lifecycle' },
    { key: 'disabled_date', label: 'Disabled on', section: 'Lifecycle' },
    { key: 'open_requests', label: 'Open requests', section: 'Lifecycle' },
    { key: 'hostnames', label: 'Devices', section: 'Devices' },
    { key: 'serial_numbers', label: 'Serial numbers', section: 'Devices' },
    { key: 'device_type', label: 'Device type', section: 'Devices' },
    { key: 'current_devices', label: 'Devices held', section: 'Devices' },
    { key: 'active_services', label: 'Active services', section: 'Services' },
    { key: 'services', label: 'Services', section: 'Services' },
    { key: 'personal_services', label: 'Personal services', section: 'Services' },
    { key: 'device_services', label: 'Device services', section: 'Services' },
    { key: 'inactive_services', label: 'Inactive services', section: 'Services' },
    { key: 'inactive_service_names', label: 'Ended services', section: 'Services' },
    { key: 'last_billed_on', label: 'Last billed on', section: 'Billing' },
    { key: 'covered_until', label: 'Billed up to', section: 'Billing' },
    { key: 'remarks', label: 'Remarks', section: 'Notes' },
  ],
  defaults: [
    'full_name',
    'username',
    'email',
    'department',
    'customer',
    'lifecycle_status',
    'start_date',
    'disabled_date',
    'hostnames',
    'serial_numbers',
    'device_type',
    'active_services',
    'services',
    'inactive_services',
    'inactive_service_names',
    'last_billed_on',
    'covered_until',
    'remarks',
  ],
  serviceFields: PERSON_SERVICE_FIELDS,
  serviceDefaults: [],
};

export const INTERNAL_DEVICES: ExportCatalogue = {
  id: 'internal:devices',
  columns: [
    { key: 'hostname', label: 'Device', section: 'Identity', required: true },
    { key: 'device_type', label: 'Type', section: 'Identity' },
    { key: 'customer', label: 'Customer', section: 'Identity' },
    { key: 'name', label: 'Reference', section: 'Identity' },
    { key: 'serial_number', label: 'Serial number', section: 'Hardware' },
    { key: 'manufacturer', label: 'Manufacturer', section: 'Hardware' },
    { key: 'model', label: 'Model', section: 'Hardware' },
    { key: 'operating_system', label: 'Operating system', section: 'Hardware' },
    { key: 'user_name', label: 'Held by', section: 'Holder' },
    { key: 'holder_username', label: 'Username', section: 'Holder' },
    { key: 'user_department', label: 'Department', section: 'Holder' },
    { key: 'user_status', label: 'Holder status', section: 'Holder' },
    { key: 'previous_holders', label: 'Previous holders', section: 'Holder' },
    { key: 'status', label: 'Status', section: 'Lifecycle' },
    { key: 'assigned_date', label: 'In service since', section: 'Lifecycle' },
    { key: 'retired_date', label: 'Retired on', section: 'Lifecycle' },
    { key: 'active_services', label: 'Active services', section: 'Services' },
    { key: 'services', label: 'Services', section: 'Services' },
    { key: 'inactive_services', label: 'Inactive services', section: 'Services' },
    { key: 'inactive_service_names', label: 'Ended services', section: 'Services' },
    { key: 'last_billed_on', label: 'Last billed on', section: 'Billing' },
    { key: 'covered_until', label: 'Billed up to', section: 'Billing' },
    { key: 'remarks', label: 'Remarks', section: 'Notes' },
  ],
  defaults: [
    'hostname',
    'device_type',
    'customer',
    'user_name',
    'holder_username',
    'user_department',
    'status',
    'serial_number',
    'assigned_date',
    'last_billed_on',
    'covered_until',
    'previous_holders',
    'services',
    'inactive_service_names',
    'active_services',
    'inactive_services',
    'remarks',
  ],
  serviceFields: DEVICE_SERVICE_FIELDS,
  serviceDefaults: [],
};

export const INTERNAL_REQUESTS: ExportCatalogue = {
  id: 'internal:requests',
  columns: [
    { key: 'name', label: 'Request', section: 'Identity', required: true },
    { key: 'customer', label: 'Customer', section: 'Identity' },
    { key: 'request_type', label: 'Type', section: 'Identity' },
    { key: 'requester', label: 'Raised by', section: 'Identity' },
    { key: 'users', label: 'People', section: 'Identity' },
    { key: 'status', label: 'Status', section: 'Progress' },
    { key: 'priority', label: 'Priority', section: 'Progress' },
    { key: 'source', label: 'Source', section: 'Progress' },
    { key: 'line_count', label: 'Lines', section: 'Progress' },
    { key: 'pending_lines', label: 'Pending', section: 'Progress' },
    { key: 'creation', label: 'Raised on', section: 'Dates' },
    { key: 'modified', label: 'Last updated', section: 'Dates' },
    { key: 'billing_run', label: 'Billing run', section: 'Dates' },
  ],
  defaults: [
    'name',
    'customer',
    'request_type',
    'status',
    'priority',
    'source',
    'requester',
    'users',
    'line_count',
    'pending_lines',
    'creation',
  ],
};

export const INTERNAL_SERVICES: ExportCatalogue = {
  id: 'internal:services',
  columns: [
    { key: 'item_name', label: 'Service', section: 'Identity', required: true },
    { key: 'name', label: 'Code', section: 'Identity' },
    { key: 'scope', label: 'Billed per', section: 'Identity' },
    { key: 'stock_uom', label: 'Unit', section: 'Identity' },
    { key: 'invoice_label', label: 'Invoice label', section: 'Billing' },
    { key: 'priced_contracts', label: 'Priced contracts', section: 'Billing' },
    { key: 'open_assignments', label: 'Open assignments', section: 'Usage' },
    { key: 'customers', label: 'Customers', section: 'Usage' },
    { key: 'state', label: 'Status', section: 'Usage' },
    { key: 'description', label: 'Description', section: 'Notes' },
  ],
  defaults: [
    'item_name',
    'name',
    'scope',
    'stock_uom',
    'invoice_label',
    'open_assignments',
    'customers',
    'priced_contracts',
    'state',
    'description',
  ],
};

export const PORTAL_USERS: ExportCatalogue = {
  id: 'portal:users',
  columns: [
    { key: 'full_name', label: 'Name', section: 'Identity', required: true },
    { key: 'username', label: 'Username', section: 'Identity' },
    { key: 'email', label: 'Email', section: 'Identity' },
    { key: 'department', label: 'Department', section: 'Identity' },
    { key: 'name', label: 'Reference', section: 'Identity' },
    { key: 'lifecycle_status', label: 'Status', section: 'Lifecycle' },
    { key: 'start_date', label: 'In service since', section: 'Lifecycle' },
    { key: 'disabled_date', label: 'Disabled on', section: 'Lifecycle' },
    { key: 'open_requests', label: 'Open requests', section: 'Lifecycle' },
    { key: 'hostnames', label: 'Devices', section: 'Devices' },
    { key: 'serial_numbers', label: 'Serial numbers', section: 'Devices' },
    { key: 'device_type', label: 'Device type', section: 'Devices' },
    { key: 'current_devices', label: 'Devices held', section: 'Devices' },
    { key: 'active_services', label: 'Active services', section: 'Services' },
    { key: 'services', label: 'Services', section: 'Services' },
    { key: 'personal_services', label: 'Personal services', section: 'Services' },
    { key: 'device_services', label: 'Device services', section: 'Services' },
    { key: 'inactive_services', label: 'Inactive services', section: 'Services' },
    { key: 'inactive_service_names', label: 'Ended services', section: 'Services' },
    { key: 'last_billed_on', label: 'Last billed on', section: 'Billing' },
    { key: 'covered_until', label: 'Billed up to', section: 'Billing' },
  ],
  defaults: [
    'full_name',
    'username',
    'email',
    'department',
    'lifecycle_status',
    'start_date',
    'disabled_date',
    'hostnames',
    'serial_numbers',
    'device_type',
    'active_services',
    'services',
    'inactive_services',
  ],
  serviceFields: PERSON_SERVICE_FIELDS,
  serviceDefaults: [],
};

export const PORTAL_DEVICES: ExportCatalogue = {
  id: 'portal:devices',
  columns: [
    { key: 'hostname', label: 'Machine', section: 'Identity', required: true },
    { key: 'device_type', label: 'Type', section: 'Identity' },
    { key: 'name', label: 'Reference', section: 'Identity' },
    { key: 'serial_number', label: 'Serial number', section: 'Hardware' },
    { key: 'manufacturer', label: 'Manufacturer', section: 'Hardware' },
    { key: 'model', label: 'Model', section: 'Hardware' },
    { key: 'operating_system', label: 'Operating system', section: 'Hardware' },
    { key: 'assigned_user_name', label: 'Held by', section: 'Holder' },
    { key: 'holder_username', label: 'Username', section: 'Holder' },
    { key: 'user_department', label: 'Department', section: 'Holder' },
    { key: 'user_status', label: 'Holder status', section: 'Holder' },
    { key: 'previous_holders', label: 'Previous holders', section: 'Holder' },
    { key: 'status', label: 'Status', section: 'Lifecycle' },
    { key: 'assigned_date', label: 'Held since', section: 'Lifecycle' },
    { key: 'retired_date', label: 'Retired on', section: 'Lifecycle' },
    { key: 'active_services', label: 'Active services', section: 'Services' },
    { key: 'services', label: 'Services', section: 'Services' },
    { key: 'inactive_services', label: 'Inactive services', section: 'Services' },
    { key: 'inactive_service_names', label: 'Ended services', section: 'Services' },
    { key: 'last_billed_on', label: 'Last billed on', section: 'Billing' },
    { key: 'covered_until', label: 'Billed up to', section: 'Billing' },
  ],
  defaults: [
    'hostname',
    'serial_number',
    'device_type',
    'model',
    'operating_system',
    'assigned_user_name',
    'status',
    'active_services',
    'services',
    'inactive_services',
    'assigned_date',
    'retired_date',
  ],
  serviceFields: DEVICE_SERVICE_FIELDS,
  serviceDefaults: [],
};

export type ExportChoice = { columns: string[]; serviceColumns: string[] };

/** The sections, in the order the picker lays them out. */
export const sectionsOf = (columns: ExportColumn[]): string[] => [
  ...new Set(columns.map((column) => column.section)),
];

const required = (catalogue: ExportCatalogue) =>
  catalogue.columns.filter((column) => column.required).map((column) => column.key);

/**
 * The picks in the order the picker shows them — section by section, and inside a section the
 * order they are listed — so the sheet reads like the modal. What is always written stays in.
 */
export const ordered = (catalogue: ExportCatalogue, keys: string[]): string[] => {
  const wanted = new Set([...keys, ...required(catalogue)]);

  return sectionsOf(catalogue.columns).flatMap((section) =>
    catalogue.columns
      .filter((column) => column.section === section && wanted.has(column.key))
      .map((column) => column.key)
  );
};

export const defaultChoice = (catalogue: ExportCatalogue): ExportChoice => ({
  columns: ordered(catalogue, catalogue.defaults),
  serviceColumns: [...(catalogue.serviceDefaults ?? [])],
});

const storageKey = (catalogue: ExportCatalogue) => `msp:export-columns:${catalogue.id}`;

export const loadChoice = (catalogue: ExportCatalogue): ExportChoice => {
  try {
    const raw = localStorage.getItem(storageKey(catalogue));
    if (!raw) return defaultChoice(catalogue);

    const saved = JSON.parse(raw) as Partial<ExportChoice>;
    const known = new Set(catalogue.columns.map((column) => column.key));
    const knownServices = new Set((catalogue.serviceFields ?? []).map((field) => field.key));

    return {
      columns: ordered(catalogue, (saved.columns ?? []).filter((key) => known.has(key))),
      serviceColumns: (saved.serviceColumns ?? []).filter((key) => knownServices.has(key)),
    };
  } catch {
    return defaultChoice(catalogue);
  }
};

export const saveChoice = (catalogue: ExportCatalogue, choice: ExportChoice): void => {
  try {
    localStorage.setItem(storageKey(catalogue), JSON.stringify(choice));
  } catch {
    /* a browser that refuses to remember still exports */
  }
};
