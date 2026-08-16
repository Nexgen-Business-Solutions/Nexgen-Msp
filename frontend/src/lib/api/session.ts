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
  customers: string[];
  customer?: string | null;
  department?: string | null;
  client_user?: string | null;
  is_portal_user?: boolean;
  is_internal_user?: boolean;
};

export const getSessionContext = (signal?: AbortSignal) =>
  get<SessionContext>(`${BASE}.get_session_context`, undefined, signal);
