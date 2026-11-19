import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useSession } from '@/shared/hooks/useSession';
import { getSectionsForRoles } from './navigation';

// DeployOps sidebar: the top item(s) with a plain icon, every section item in its own soft colour
// tile, the current page as a blue gradient pill. Colours go by position down the menu.
const TILE_COLORS = [
  'bg-blue-100/80 text-blue-600 ring-blue-200/60',
  'bg-emerald-100/80 text-emerald-600 ring-emerald-200/60',
  'bg-violet-100/80 text-violet-600 ring-violet-200/60',
  'bg-amber-100/80 text-amber-600 ring-amber-200/60',
  'bg-teal-100/80 text-teal-600 ring-teal-200/60',
  'bg-rose-100/80 text-rose-600 ring-rose-200/60',
  'bg-indigo-100/80 text-indigo-600 ring-indigo-200/60',
  'bg-sky-100/80 text-sky-600 ring-sky-200/60',
];

const SidebarNav: React.FC<{ onNavigate?: () => void }> = ({ onNavigate }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: session } = useSession();
  const sections = getSectionsForRoles(session?.roles);
  // a tile colour per item down the whole menu, so no two neighbours across sections match
  const tileOf = new Map(
    sections.flatMap((section) => (section.label ? section.items : [])).map((item, i) => [item.id, TILE_COLORS[i % TILE_COLORS.length]])
  );

  const go = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  const isActive = (path: string, end?: boolean) =>
    end ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);

  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-6 pt-3 lg:pt-4">
      {sections.map((section) => (
        <div key={section.id} className="flex flex-col gap-1">
          {section.label && (
            <p className="mt-6 px-4 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              {section.label}
            </p>
          )}
          {section.items.map(({ id, label, icon: Icon, path, end }) => {
            const active = isActive(path, end);
            return (
              <button
                key={id}
                type="button"
                onClick={() => go(path)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-4 py-2 text-left text-[15px] font-medium transition ${
                  active
                    ? 'bg-linear-to-r from-blue-600 to-blue-700 text-white shadow-md shadow-blue-600/25'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {section.label ? (
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-lg ring-1 ${tileOf.get(id)}`}
                  >
                    <Icon className="size-4" strokeWidth={1.75} />
                  </span>
                ) : (
                  <Icon className="size-[18px] shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </button>
            );
          })}
        </div>
      ))}
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
        <div className="absolute inset-0 bg-slate-950/30 backdrop-blur-[2px]" onClick={onClose} />
        <aside className="absolute left-0 top-0 flex h-full w-72 flex-col border-r border-slate-200 bg-white">
          <div className="flex justify-end px-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="grid size-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"
            >
              <X className="size-5" />
            </button>
          </div>
          <SidebarNav onNavigate={onClose} />
        </aside>
      </div>
    )}
  </>
);

export default AppSidebar;
