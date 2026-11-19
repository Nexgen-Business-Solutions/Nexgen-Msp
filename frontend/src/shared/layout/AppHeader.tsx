import React from 'react';
import { Menu } from 'lucide-react';
import UserMenu from './UserMenu';

const APP_NAME = 'Nexgen MSP';
const APP_TAGLINE = 'Service and billing portal';

const AppHeader: React.FC<{ onMenuClick?: () => void }> = ({ onMenuClick }) => (
  <div className="border-b border-line bg-white px-4 sm:px-6">
    <div className="flex h-16 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open menu"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-ink lg:hidden"
        >
          <Menu size={18} />
        </button>
        <img src='/assets/nexgen_msp/images/Nexgen-Logo.png' width='64' alt="Nexgen" />
        <div className="min-w-0 border-l border-line pl-3">
          <h1 className="truncate text-[15px] font-semibold text-ink">{APP_NAME}</h1>
          <p className="truncate text-xs text-muted-ink">{APP_TAGLINE}</p>
        </div>
      </div>

      <UserMenu />
    </div>
  </div>
);

export default AppHeader;
