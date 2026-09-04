import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronDown, LogOut, Mail, ShieldCheck } from 'lucide-react';
import { logout } from '@/lib/api/client';
import MyTwoFactorModal from '@/features/auth/components/MyTwoFactorModal';
import { useSession } from '@/shared/hooks/useSession';
import ConfirmModal from '@/shared/components/ConfirmModal';

const getInitials = (fullName?: string | null, email?: string | null) => {
  const source = (fullName || '').trim();

  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return source.slice(0, 2).toUpperCase();
  }

  return (email || '?').slice(0, 2).toUpperCase();
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
          className={`flex items-center gap-2.5 rounded-xl border px-2 py-1.5 transition-colors ${
            open ? 'border-slate-200 bg-slate-50' : 'border-transparent hover:bg-slate-50'
          }`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-600 to-blue-800 text-xs font-bold text-white">
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
          <div className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-slate-100 bg-white shadow-xl">
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-600 to-blue-800 text-sm font-bold text-white">
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
