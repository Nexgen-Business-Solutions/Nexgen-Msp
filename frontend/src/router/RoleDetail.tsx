import type { ReactElement } from 'react';
import { useSession } from '@/shared/hooks/useSession';
import { isPortalOnly } from '@/shared/layout/navigation';

/** Same path, different page: the customer sees their view, Nexgen staff see theirs. */
export default function RoleDetail({
  portal,
  internal,
}: {
  portal: ReactElement;
  internal: ReactElement;
}) {
  const { data: session, isLoading } = useSession();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  return isPortalOnly(session?.roles) ? portal : internal;
}
