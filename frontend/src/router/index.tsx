import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Laptop, LayoutDashboard, Users } from 'lucide-react';
import LoginScreen from '@/features/auth/pages/LoginScreen';
import AppLayout from '@/shared/layout/AppLayout';
import ModulePlaceholder from '@/shared/layout/ModulePlaceholder';
import AuthGuard from './guards/AuthGuard';

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
      {
        index: true,
        element: (
          <ModulePlaceholder
            icon={LayoutDashboard}
            title="Dashboard"
            description="This module is not built yet."
          />
        ),
      },
      {
        path: 'client-users',
        element: (
          <ModulePlaceholder
            icon={Users}
            title="Client Users"
            description="This module is not built yet."
          />
        ),
      },
      {
        path: 'devices',
        element: (
          <ModulePlaceholder
            icon={Laptop}
            title="Devices"
            description="This module is not built yet."
          />
        ),
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/msp" replace />,
  },
]);
