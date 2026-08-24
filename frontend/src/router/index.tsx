import { createBrowserRouter, Navigate } from 'react-router-dom';
import LoginScreen from '@/features/auth/pages/LoginScreen';
import ForgotPassword from '@/features/auth/pages/ForgotPassword';
import ResetPassword from '@/features/auth/pages/ResetPassword';
import AppLayout from '@/shared/layout/AppLayout';
import AuthGuard from './guards/AuthGuard';
import RoleHome from './RoleHome';
import PortalReports from '@/features/portal/pages/PortalReports';
import PortalRequests from '@/features/portal/pages/PortalRequests';
import PortalInvoiceDetail from '@/features/portal/pages/PortalInvoiceDetail';
import PortalBilling from '@/features/portal/pages/PortalBilling';
import NewServiceRequest from '@/features/portal/pages/NewServiceRequest';
import InternalGuard from './guards/InternalGuard';
import RequestsList from '@/features/internal/pages/RequestsList';
import RequestDetail from '@/features/internal/pages/RequestDetail';
import UsersList from '@/features/internal/pages/UsersList';
import UserDetail from '@/features/internal/pages/UserDetail';
import DeviceDetail from '@/features/internal/pages/DeviceDetail';
import ServiceDetail from '@/features/internal/pages/ServiceDetail';
import DevicesList from '@/features/internal/pages/DevicesList';
import ActivityLog from '@/features/internal/pages/ActivityLog';
import Settings from '@/features/internal/pages/Settings';
import PortalRequestDetail from '@/features/portal/pages/PortalRequestDetail';
import PortalUserDetail from '@/features/portal/pages/PortalUserDetail';
import RoleDetail from './RoleDetail';
import AdminGuard from './guards/AdminGuard';
import CustomersList from '@/features/internal/pages/CustomersList';
import ServicesList from '@/features/internal/pages/ServicesList';
import CustomerContract from '@/features/internal/pages/CustomerContract';
import BillingRuns from '@/features/internal/pages/BillingRuns';
import NewBillingRun from '@/features/internal/pages/NewBillingRun';
import BillingRunDetail from '@/features/internal/pages/BillingRunDetail';

export const router = createBrowserRouter([
  {
    path: '/msp/login',
    element: <LoginScreen />,
  },
  {
    path: '/msp/forgot-password',
    element: <ForgotPassword />,
  },
  {
    path: '/msp/reset-password',
    element: <ResetPassword />,
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
      { path: 'reports', element: <PortalReports /> },
      { path: 'invoices', element: <PortalBilling /> },
      { path: 'invoices/:name', element: <PortalInvoiceDetail /> },
      { path: 'requests/new', element: <NewServiceRequest /> },
      {
        path: 'requests',
        element: <RoleDetail portal={<PortalRequests />} internal={<RequestsList />} />,
      },
      {
        path: 'users',
        element: (
          <InternalGuard>
            <UsersList />
          </InternalGuard>
        ),
      },
      {
        path: 'users/:name',
        element: <RoleDetail portal={<PortalUserDetail />} internal={<UserDetail />} />,
      },
      {
        path: 'devices',
        element: (
          <InternalGuard>
            <DevicesList />
          </InternalGuard>
        ),
      },
      {
        path: 'devices/:name',
        element: (
          <InternalGuard>
            <DeviceDetail />
          </InternalGuard>
        ),
      },
      {
        path: 'activity',
        element: (
          <InternalGuard>
            <ActivityLog />
          </InternalGuard>
        ),
      },
      {
        path: 'settings',
        element: (
          <AdminGuard>
            <Settings />
          </AdminGuard>
        ),
      },
      {
        path: 'services',
        element: (
          <AdminGuard>
            <ServicesList />
          </AdminGuard>
        ),
      },
      {
        path: 'services/:name',
        element: (
          <AdminGuard>
            <ServiceDetail />
          </AdminGuard>
        ),
      },
      {
        path: 'customers',
        element: (
          <AdminGuard>
            <CustomersList />
          </AdminGuard>
        ),
      },
      {
        path: 'customers/:customer',
        element: (
          <AdminGuard>
            <CustomerContract />
          </AdminGuard>
        ),
      },
      {
        path: 'billing',
        element: (
          <AdminGuard>
            <BillingRuns />
          </AdminGuard>
        ),
      },
      {
        path: 'billing/new',
        element: (
          <AdminGuard>
            <NewBillingRun />
          </AdminGuard>
        ),
      },
      {
        path: 'billing/:name',
        element: (
          <AdminGuard>
            <BillingRunDetail />
          </AdminGuard>
        ),
      },
      {
        path: 'requests/:name',
        element: <RoleDetail portal={<PortalRequestDetail />} internal={<RequestDetail />} />,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/msp" replace />,
  },
]);
