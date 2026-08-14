import {
  ClipboardList,
  Laptop,
  LayoutDashboard,
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

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/msp', end: true },
  { id: 'client-users', label: 'Client Users', icon: Users, path: '/msp/client-users' },
  { id: 'devices', label: 'Devices', icon: Laptop, path: '/msp/devices' },
];

export const PAGE_FALLBACK: NavItem = {
  id: 'fallback',
  label: 'Nexgen MSP',
  icon: ClipboardList,
  path: '/msp',
};

export const findNavItem = (pathname: string): NavItem => {
  const matches = NAV_ITEMS.filter(
    (item) => pathname === item.path || (!item.end && pathname.startsWith(`${item.path}/`))
  );

  if (!matches.length) return PAGE_FALLBACK;

  return matches.reduce((best, item) => (item.path.length > best.path.length ? item : best));
};
