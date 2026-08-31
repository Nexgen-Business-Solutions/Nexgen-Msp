import { get, post } from './client';

const AUTH = 'nexgen_msp.api.auth.endpoints.v1';
const TFA = 'nexgen_msp.api.two_factor.endpoints.v1';

export type PreLogin = {
  pending_token: string;
  requires_2fa: boolean;
  needs_setup: boolean;
  full_name: string;
  expires_in: number;
};

export type CompletedLogin = {
  ok: true;
  user: string;
  full_name: string;
  roles: string[];
  session_expiry_seconds: number;
};

export type SetupChallenge = {
  issuer: string;
  account: string;
  secret: string;
  otpauth_uri: string;
  expires_in: number;
  already_enabled?: boolean;
};

export type TwoFactorStatus = {
  user: string;
  enabled: boolean;
  method: string;
  gate_passed: boolean;
  session_expiry_seconds: number;
};

/** Checks the password and opens nothing: the answer is a short-lived token. */
export const preLogin = (username: string, password: string) =>
  post<PreLogin>(`${AUTH}.pre_login`, { username, password });

/** Turns that token into a session, once the code proves the second factor. */
export const completeLogin = (payload: {
  pending_token: string;
  otp?: string;
  username?: string;
}) => post<CompletedLogin>(`${AUTH}.complete_login`, payload);

export const startTwoFactorSetup = (pending_token?: string) =>
  post<SetupChallenge>(`${TFA}.start_two_factor_setup`, { pending_token });

export const verifyTwoFactorSetup = (otp: string, pending_token?: string) =>
  post<{ ok: true; enabled: true }>(`${TFA}.verify_two_factor_setup`, { otp, pending_token });

export const verifyTwoFactor = (code: string) =>
  post<{ ok: true; user: string; session_expiry_seconds: number }>(
    `${TFA}.verify_two_factor`,
    { code }
  );

export const getTwoFactorStatus = (signal?: AbortSignal) =>
  get<TwoFactorStatus>(`${TFA}.get_two_factor_status`, undefined, signal);

export const resetTwoFactor = (user: string) =>
  post<{ ok: true; user: string; enabled: false }>(`${TFA}.reset_two_factor`, { user });
