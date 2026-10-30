import { useSession } from '@/shared/hooks/useSession';
import { isPortalOnly } from '@/shared/layout/navigation';
import PortalDashboard from '@/features/portal/pages/PortalDashboard';
import InternalDashboard from '@/features/internal/pages/InternalDashboard';

/**
 * The dashboard an account opens on: ours, or its own company's.
 *
 * The internal one used to be the default — anything that did not read as portal-only got
 * it, which handed it to accounts that read as neither side and could load nothing in it.
 * The server already says which an account is, so that is what decides, and what it does
 * not call ours opens the company's own screen.
 */
export default function RoleHome() {
  const { data: session, isLoading } = useSession();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  const ours = session?.is_internal_user ?? !isPortalOnly(session?.roles);

  return ours ? <InternalDashboard /> : <PortalDashboard />;
}
