import { createBrowserRouter, Navigate } from 'react-router-dom';
import LoginScreen from '@/features/auth/pages/LoginScreen';
import AppLayout from '@/shared/layout/AppLayout';
import AuthGuard from './guards/AuthGuard';
import RoleHome from './RoleHome';
import ClientUsers from '@/pages/ClientUsers';
import Devices from '@/pages/Devices';
import PortalRecords from '@/features/portal/pages/PortalRecords';

export const router = createBrowserRouter([
  {
    path: '/msp/login',
    element: <LoginScreen />,
  },
  {
    path: '/msp',
    element: (
      <AuthGuard>
        <AppLayout />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <RoleHome /> },
      { path: 'client-users', element: <ClientUsers /> },
      { path: 'devices', element: <Devices /> },
      { path: 'records', element: <PortalRecords /> },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/msp" replace />,
  },
]);
