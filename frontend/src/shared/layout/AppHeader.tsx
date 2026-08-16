import React from 'react';
import { Menu } from 'lucide-react';
import UserMenu from './UserMenu';

const APP_NAME = 'Nexgen MSP';
const APP_TAGLINE = 'Service and billing portal';

const AppHeader: React.FC<{ onMenuClick?: () => void }> = ({ onMenuClick }) => (
  <div className="border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
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

      <UserMenu />
    </div>
  </div>
);

export default AppHeader;
