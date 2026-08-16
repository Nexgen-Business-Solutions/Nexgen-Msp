import { useSession } from '@/shared/hooks/useSession';
import { isPortalOnly } from '@/shared/layout/navigation';
import PortalDashboard from '@/features/portal/pages/PortalDashboard';
import Dashboard from '@/pages/Dashboard';

export default function RoleHome() {
  const { data: session, isLoading } = useSession();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  return isPortalOnly(session?.roles) ? <PortalDashboard /> : <Dashboard />;
}
