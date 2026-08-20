import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useSession } from '@/shared/hooks/useSession';
import { findNavItem, getNavForRoles, getPagesForRoles } from './navigation';

const Breadcrumb: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: session } = useSession();

  const navItems = getNavForRoles(session?.roles);
  const current = findNavItem(pathname, getPagesForRoles(session?.roles));
  const home = navItems[0];
  const isHome = current.id === home?.id;

  return (
    <div className="px-6 pt-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs">
        <button
          type="button"
          onClick={() => navigate(home?.path ?? '/msp')}
          className="text-slate-400 transition-colors hover:text-slate-600"
        >
          {home?.label ?? 'Home'}
        </button>

        {!isHome && (
          <>
            <ChevronRight size={13} className="shrink-0 text-slate-300" />
            <span className="font-medium text-slate-600">{current.label}</span>
          </>
        )}
      </nav>

      <h1 className="mt-1.5 truncate text-2xl font-bold text-slate-900">{current.label}</h1>
    </div>
  );
};

export default Breadcrumb;
