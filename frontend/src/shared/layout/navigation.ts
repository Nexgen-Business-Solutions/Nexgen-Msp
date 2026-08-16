import {
  ClipboardList,
  LayoutDashboard,
  Laptop,
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
export const INTERNAL_ROLES = [
  'MSP System Admin',
  'MSP Technician',
  'System Manager',
  'Administrator',
];

export const INTERNAL_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/msp', end: true },
  { id: 'client-users', label: 'Client Users', icon: Users, path: '/msp/client-users' },
  { id: 'devices', label: 'Devices', icon: Laptop, path: '/msp/devices' },
];

export const PORTAL_NAV: NavItem[] = [
  { id: 'portal-dashboard', label: 'Portal Dashboard', icon: LayoutDashboard, path: '/msp', end: true },
  { id: 'portal-records', label: 'Records', icon: Table2, path: '/msp/records' },
];

export const PAGE_FALLBACK: NavItem = {
  id: 'fallback',
  label: 'Nexgen MSP',
  icon: ClipboardList,
  path: '/msp',
};

export const isPortalOnly = (roles: string[] = []) =>
  roles.includes(PORTAL_ROLE) && !roles.some((role) => INTERNAL_ROLES.includes(role));

export const getNavForRoles = (roles: string[] = []) =>
  isPortalOnly(roles) ? PORTAL_NAV : INTERNAL_NAV;

export const findNavItem = (pathname: string, items: NavItem[]): NavItem => {
  const matches = items.filter(
    (item) => pathname === item.path || (!item.end && pathname.startsWith(`${item.path}/`))
  );

  if (!matches.length) return PAGE_FALLBACK;

  return matches.reduce((best, item) => (item.path.length > best.path.length ? item : best));
};
