import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Check, ChevronDown, LayoutGrid, LogOut, Mail, ShieldCheck } from 'lucide-react';
import { logout } from '@/lib/api/client';
import MyTwoFactorModal from '@/features/auth/components/MyTwoFactorModal';
import { useSession } from '@/shared/hooks/useSession';
import ConfirmModal from '@/shared/components/ConfirmModal';
import { useThemeStore } from '@/theme';

const getInitials = (fullName?: string | null, email?: string | null) => {
  const source = (fullName || '').trim();

  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return source.slice(0, 2).toUpperCase();
  }

  return (email || '?').slice(0, 2).toUpperCase();
};

/** Accent colour of the whole app; remembered on this device. */
const Appearance: React.FC = () => {
  const { currentTheme, availableThemes, changeLocalTheme } = useThemeStore();
  return (
    <div className="border-t border-slate-100 px-4 py-3.5">
      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Appearance</p>
      <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-2">
        {availableThemes.map((theme) => {
          const active = theme.id === currentTheme.id;
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={theme.name}
              title={theme.name}
              onClick={() => changeLocalTheme(theme.id)}
              style={{ backgroundColor: theme.swatch }}
              className={`flex h-7 w-7 items-center justify-center rounded-full text-white transition-transform hover:scale-110 ${
                active ? 'ring-2 ring-slate-900/80 ring-offset-2' : ''
              }`}
            >
              {active && <Check size={14} strokeWidth={3} />}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-500">{currentTheme.name}</p>
    </div>
  );
};

const UserMenu: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const email = session?.user ?? '';
  // only an account Frappe lets onto the desk is offered the way there
  const reachesDesk = session?.user_type === 'System User';
  const fullName = session?.full_name || email;
  const initials = getInitials(session?.full_name, email);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      queryClient.clear();
      navigate('/msp/login', { replace: true });
    }
  };

  const details = [
    { icon: Mail, value: email },
    { icon: Building2, value: session?.customer },
  ].filter((item) => Boolean(item.value));

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2.5 transition-colors ${
            open ? 'bg-slate-100' : 'hover:bg-slate-100'
          }`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500 text-xs font-semibold text-white">
            {initials}
          </span>
          <span className="hidden max-w-[10rem] truncate text-sm font-semibold text-slate-700 md:inline">
            {fullName}
          </span>
          <ChevronDown
            size={14}
            className={`hidden shrink-0 text-slate-400 transition-transform duration-200 md:block ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>

        {open && (
          <div className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-900/5">
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-500 text-sm font-semibold text-white">
                {initials}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{fullName}</p>
                <p className="truncate text-xs text-slate-400">{email}</p>
              </div>
            </div>

            <div className="space-y-2.5 px-4 py-3.5">
              {details.map(({ icon: Icon, value }) => (
                <div key={value as string} className="flex items-center gap-2.5">
                  <Icon size={14} className="shrink-0 text-slate-400" />
                  <span className="truncate text-sm text-slate-600" title={value as string}>
                    {value}
                  </span>
                </div>
              ))}
            </div>

            <Appearance />

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setSecurityOpen(true);
              }}
              className="flex w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <ShieldCheck size={15} className="shrink-0" />
              Two-factor authentication
            </button>

            {reachesDesk && (
              <a
                href="/app"
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
              >
                <LayoutGrid size={15} className="shrink-0" />
                Open Desk
              </a>
            )}

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirmOpen(true);
              }}
              className="flex w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-sm font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600"
            >
              <LogOut size={15} className="shrink-0" />
              Sign out
            </button>
          </div>
        )}
      </div>

      <MyTwoFactorModal open={securityOpen} onClose={() => setSecurityOpen(false)} />

      <ConfirmModal
        open={confirmOpen}
        title="Sign out"
        description="You will be returned to the sign-in page and will need to enter your credentials again."
        confirmLabel="Sign out"
        tone="danger"
        loading={loggingOut}
        onConfirm={handleLogout}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
};

export default UserMenu;
