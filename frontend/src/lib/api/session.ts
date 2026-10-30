import { get } from './client';

const BASE = 'nexgen_msp.api.core.endpoints.v1';

/** Whether this account may be in the application at all, decided by `access.entry`. */
export type AccessVerdict = {
  ok: boolean;
  code: string | null;
  message: string | null;
};

/**
 * Where this account is sent after signing in, decided by `LoginRuleService`.
 *
 * Absent while the site still routes the old way, which is what the server switch turns off.
 * A successful destination has already been authorised server-side; it is never a permission
 * the client may grant itself.
 */
export type LoginDestination = {
  success: boolean;
  rule: string | null;
  source: string | null;
  path: string | null;
  error: string | null;
};

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
  two_factor_enabled?: boolean;
  two_factor_passed?: boolean;
  session_expiry_seconds?: number;
  is_portal_user?: boolean;
  can_see_invoices?: boolean;
  is_internal_user?: boolean;
  access?: AccessVerdict;
  login_destination?: LoginDestination | null;
  can_open_desk?: boolean;
};

/** A password-authenticated session is not an application session until its 2FA gate passed. */
export const mayEnterApplication = (
  session?: Pick<SessionContext, 'authenticated' | 'two_factor_passed'> | null
) => Boolean(session?.authenticated && session.two_factor_passed);

export const getSessionContext = (signal?: AbortSignal) =>
  get<SessionContext>(`${BASE}.get_session_context`, undefined, signal);
