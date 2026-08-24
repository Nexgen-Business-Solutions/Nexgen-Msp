import {
  Building2,
  Coins,
  ClipboardList,
  FilePlus2,
  Inbox,
  Laptop,
  LayoutDashboard,
  History,
  Package,
  Receipt,
  Settings2,
  Table2,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
  end?: boolean;
};

export const PORTAL_ROLE = 'Customer Portal Manager';
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
  { id: 'portal-reports', label: 'Reports', icon: Table2, path: '/msp/reports' },
  { id: 'portal-requests', label: 'Requests', icon: Inbox, path: '/msp/requests' },
  { id: 'portal-invoices', label: 'Invoices', icon: Receipt, path: '/msp/invoices' },
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

export const isPortalOnly = (roles: string[] = []) =>
  roles.includes(PORTAL_ROLE) && !roles.some((role) => INTERNAL_ROLES.includes(role));

export const isAdmin = (roles: string[] = []) => roles.some((role) => ADMIN_ROLES.includes(role));

export type NavSection = { id: string; label: string | null; items: NavItem[] };

const OPERATIONS = INTERNAL_NAV.slice(1);

const COMMERCIAL: NavItem[] = [
  { id: 'services', label: 'Services', icon: Package, path: '/msp/services' },
  { id: 'customers', label: 'Customers', icon: Building2, path: '/msp/customers' },
  { id: 'billing', label: 'Billing', icon: Coins, path: '/msp/billing' },
];

/** The sidebar, grouped. The first entry stands alone above the groups. */
export const getSectionsForRoles = (roles: string[] = []): NavSection[] => {
  if (isPortalOnly(roles)) {
    return [
      { id: 'top', label: null, items: PORTAL_NAV.slice(0, 1) },
      { id: 'company', label: 'My company', items: PORTAL_NAV.slice(1) },
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
    bottom.push({ id: 'settings', label: 'Settings', icon: Settings2, path: '/msp/settings' });
  }

  sections.push({ id: 'system', label: 'System', items: bottom });

  return sections;
};

export const getNavForRoles = (roles: string[] = []) =>
  getSectionsForRoles(roles).flatMap((section) => section.items);

export const getPagesForRoles = (roles: string[] = []) =>
  isPortalOnly(roles) ? [...PORTAL_NAV, ...PORTAL_PAGES] : getNavForRoles(roles);

export const findNavItem = (pathname: string, items: NavItem[]): NavItem => {
  const matches = items.filter(
    (item) => pathname === item.path || (!item.end && pathname.startsWith(`${item.path}/`))
  );

  if (!matches.length) return PAGE_FALLBACK;

  return matches.reduce((best, item) => (item.path.length > best.path.length ? item : best));
};
