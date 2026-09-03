import {
  Building2,
  Coins,
  ClipboardList,
  FilePlus2,
  Inbox,
  Laptop,
  Layers,
  LayoutDashboard,
  History,
  Package,
  Receipt,
  Settings2,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  id: string;
  label: string;
  /** hidden from a Customer Operator, who does everything here except the money */
  needsInvoices?: boolean;
  icon: LucideIcon;
  path: string;
  end?: boolean;
};

export const CUSTOMER_MANAGER_ROLE = 'MSP Customer Manager';
export const CUSTOMER_OPERATOR_ROLE = 'MSP Customer Operator';

/** The customer side, mirroring permissions.CUSTOMER_ROLES on the server. */
export const CUSTOMER_ROLES = [CUSTOMER_MANAGER_ROLE, CUSTOMER_OPERATOR_ROLE];
export const ADMIN_ROLES = ['MSP System Admin', 'System Manager', 'Administrator'];
export const INTERNAL_ROLES = [
  'MSP System Admin',
  'MSP Technician',
  'System Manager',
  'Administrator',
];

export const INTERNAL_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/msp', end: true },
  { id: 'requests', label: 'Requests', icon: Inbox, path: '/msp/requests' },
  { id: 'users', label: 'Users', icon: Users, path: '/msp/users' },
  { id: 'devices', label: 'Devices', icon: Laptop, path: '/msp/devices' },
];

// history sits at the very bottom, under whatever the role adds above it
const ACTIVITY: NavItem = {
  id: 'activity',
  label: 'Activity',
  icon: History,
  path: '/msp/activity',
};



export const PORTAL_NAV: NavItem[] = [
  { id: 'portal-dashboard', label: 'Portal Dashboard', icon: LayoutDashboard, path: '/msp', end: true },
  { id: 'portal-requests', label: 'Requests', icon: Inbox, path: '/msp/requests' },
  { id: 'portal-users', label: 'Users', icon: Users, path: '/msp/users' },
  { id: 'portal-devices', label: 'Devices', icon: Laptop, path: '/msp/devices' },
  { id: 'portal-services', label: 'Services', icon: Layers, path: '/msp/services' },
  { id: 'portal-invoices', label: 'Invoices', icon: Receipt, path: '/msp/invoices', needsInvoices: true },
];

export const PORTAL_PAGES: NavItem[] = [
  { id: 'portal-new-request', label: 'New Request', icon: FilePlus2, path: '/msp/requests/new' },
];

export const PAGE_FALLBACK: NavItem = {
  id: 'fallback',
  label: 'Nexgen MSP',
  icon: ClipboardList,
  path: '/msp',
};

/**
 * An account of a customer, and of no other kind.
 *
 * Both customer roles count, not just the manager: an operator was falling through to the
 * internal sidebar because only one of the two was named here.
 */
export const isPortalOnly = (roles: string[] = []) =>
  roles.some((role) => CUSTOMER_ROLES.includes(role)) &&
  !roles.some((role) => INTERNAL_ROLES.includes(role));

export const isAdmin = (roles: string[] = []) => roles.some((role) => ADMIN_ROLES.includes(role));

export type NavSection = { id: string; label: string | null; items: NavItem[] };

const OPERATIONS = INTERNAL_NAV.slice(1);

const COMMERCIAL: NavItem[] = [
  { id: 'services', label: 'Services', icon: Package, path: '/msp/services' },
  { id: 'customers', label: 'Customers', icon: Building2, path: '/msp/customers' },
  { id: 'billing', label: 'Billing', icon: Coins, path: '/msp/billing' },
];

/** The sidebar, grouped. The first entry stands alone above the groups. */
/** A Customer Operator does everything a Customer Manager does, except the money. */
const seesInvoices = (roles: string[] = []) => !roles.includes(CUSTOMER_OPERATOR_ROLE);

export const getSectionsForRoles = (roles: string[] = []): NavSection[] => {
  if (isPortalOnly(roles)) {
    const items = PORTAL_NAV.filter((item) => !item.needsInvoices || seesInvoices(roles));

    return [
      { id: 'top', label: null, items: items.slice(0, 1) },
      { id: 'company', label: 'My company', items: items.slice(1) },
    ];
  }

  const sections: NavSection[] = [
    { id: 'top', label: null, items: INTERNAL_NAV.slice(0, 1) },
    { id: 'operations', label: 'Operations', items: OPERATIONS },
  ];

  if (isAdmin(roles)) {
    sections.push({ id: 'commercial', label: 'Commercial', items: COMMERCIAL });
  }

  const bottom: NavItem[] = [ACTIVITY];

  if (isAdmin(roles)) {
    bottom.push({ id: 'accounts', label: 'Accounts', icon: UserCog, path: '/msp/accounts' });
    bottom.push({ id: 'settings', label: 'Settings', icon: Settings2, path: '/msp/settings' });
  }

  sections.push({ id: 'system', label: 'System', items: bottom });

  return sections;
};

export const getNavForRoles = (roles: string[] = []) =>
  getSectionsForRoles(roles).flatMap((section) => section.items);

export const getPagesForRoles = (roles: string[] = []) =>
  isPortalOnly(roles)
    ? [
        ...PORTAL_NAV.filter((item) => !item.needsInvoices || seesInvoices(roles)),
        ...PORTAL_PAGES,
      ]
    : getNavForRoles(roles);

export const findNavItem = (pathname: string, items: NavItem[]): NavItem => {
  const matches = items.filter(
    (item) => pathname === item.path || (!item.end && pathname.startsWith(`${item.path}/`))
  );

  if (!matches.length) return PAGE_FALLBACK;

  return matches.reduce((best, item) => (item.path.length > best.path.length ? item : best));
};
