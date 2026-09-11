import { useState } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import AppSidebar from './AppSidebar';
import AppHeader from './AppHeader';
import Breadcrumb from './Breadcrumb';

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const customerList = useMatch('/msp/customers');

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <AppHeader onMenuClick={() => setSidebarOpen(true)} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {/* The customer list supplies its header with the create action. */}
          {!customerList && <Breadcrumb />}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
