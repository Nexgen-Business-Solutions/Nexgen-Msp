import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useSession } from '@/shared/hooks/useSession';
import { getNavForRoles } from './navigation';

const SidebarNav: React.FC<{ onNavigate?: () => void }> = ({ onNavigate }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: session } = useSession();
  const navItems = getNavForRoles(session?.roles);

  const go = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  const isActive = (path: string, end?: boolean) =>
    end ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);

  return (
    <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-4">
      <div className="space-y-1">
        {navItems.map(({ id, label, icon: Icon, path, end }) => {
          const active = isActive(path, end);
          return (
            <button
              key={id}
              type="button"
              onClick={() => go(path)}
              className={`flex h-11 w-full items-center gap-3 rounded-xl px-4 text-sm transition-all duration-200 ease-out ${
                active
                  ? 'bg-linear-to-r from-blue-600 to-blue-700 font-semibold text-white shadow-md shadow-blue-600/20'
                  : 'font-medium text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Icon size={18} className={active ? 'text-white' : 'text-slate-500'} />
              <span className="truncate text-left">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

const AppSidebar: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => (
  <>
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
      <SidebarNav />
    </aside>

    {open && (
      <div className="fixed inset-0 z-[70] lg:hidden">
        <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
        <aside className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-slate-200 bg-white shadow-xl">
          <div className="flex justify-end px-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <X size={18} />
            </button>
          </div>
          <SidebarNav onNavigate={onClose} />
        </aside>
      </div>
    )}
  </>
);

export default AppSidebar;
