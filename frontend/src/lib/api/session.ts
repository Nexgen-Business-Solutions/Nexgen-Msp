import { get } from './client';

const BASE = 'nexgen_msp.api.core.endpoints.v1';

export type SessionContext = {
  user: string;
  authenticated: boolean;
  full_name?: string;
  first_name?: string | null;
  last_name?: string | null;
  user_image?: string | null;
  user_type?: string | null;
  roles: string[];
  customer_profile_role?: 'MSP System Admin' | 'MSP Technician' | 'MSP Customer Manager' | 'MSP Customer Operator' | null;
  customers: string[];
  customer?: string | null;
  two_factor_enabled?: boolean;
  two_factor_passed?: boolean;
  session_expiry_seconds?: number;
  is_portal_user?: boolean;
  can_see_invoices?: boolean;
  is_internal_user?: boolean;
};

export const getSessionContext = (signal?: AbortSignal) =>
  get<SessionContext>(`${BASE}.get_session_context`, undefined, signal);
