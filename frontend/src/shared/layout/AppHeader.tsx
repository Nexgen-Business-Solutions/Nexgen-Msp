import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleUserRound, LogOut, Menu, User2 } from 'lucide-react';
import { getLoggedUser, logout } from '@/lib/api/client';

const APP_NAME = 'Nexgen MSP';
const APP_TAGLINE = 'Service and billing portal';

const AppHeader: React.FC<{ onMenuClick?: () => void }> = ({ onMenuClick }) => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<string | null>(null);

  useEffect(() => {
    getLoggedUser().then(setCurrentUser);
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate('/msp/login', { replace: true });
    }
  };

  return (
    <div className="border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open menu"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 lg:hidden"
          >
            <Menu size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-gray-900 sm:text-xl">{APP_NAME}</h1>
            <p className="truncate text-xs text-blue-700">{APP_TAGLINE}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-blue-700 bg-blue-50 text-blue-600">
              <User2 size={20} />
            </span>
            {currentUser && (
              <span className="hidden max-w-[14rem] truncate text-sm text-gray-600 md:inline">
                {currentUser}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={handleLogout}
            aria-label="Sign out"
            title="Sign out"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AppHeader;
