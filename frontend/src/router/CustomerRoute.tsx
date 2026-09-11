import { Navigate } from 'react-router-dom';
import { useSession } from '@/shared/hooks/useSession';
import { customerRole } from '@/features/internal/customerAccess';
import CustomerContract from '@/features/internal/pages/CustomerContract';
import CustomerDirectory from '@/features/internal/pages/CustomerDirectory';
import CustomersList from '@/features/internal/pages/CustomersList';
import CustomerProfile from '@/features/internal/pages/CustomerProfile';

export default function CustomerRoute({ view }: { view: 'list' | 'detail' | 'profile' }) {
  const { data: session, isLoading } = useSession();
  if (isLoading) return <p className="p-6 text-sm text-slate-500">Loading…</p>;
  const role = customerRole(session);
  if (view === 'profile') {
    return role === 'MSP Customer Manager' || role === 'MSP Customer Operator'
      ? <CustomerProfile own /> : <Navigate to="/msp" replace />;
  }
  if (role === 'MSP System Admin') return view === 'list' ? <CustomersList /> : <CustomerContract />;
  if (role === 'MSP Technician') return view === 'list' ? <CustomerDirectory /> : <CustomerProfile />;
  return <Navigate to="/msp" replace />;
}
