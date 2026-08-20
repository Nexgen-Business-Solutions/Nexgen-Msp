import { post } from './client';

/** Frappe already rate-limits this and answers the same way whether or not the account exists. */
export const requestPasswordReset = (user: string) =>
  post<string>('frappe.core.doctype.user.user.reset_password', { user });

export const updatePassword = (key: string, newPassword: string, logoutAllSessions = 1) =>
  post<string>('frappe.core.doctype.user.user.update_password', {
    key,
    new_password: newPassword,
    logout_all_sessions: logoutAllSessions,
  });

export type PasswordStrength = {
  score: number;
  feedback?: {
    password_policy_validation_passed?: boolean;
    warning?: string;
    suggestions?: string[];
  };
};

export const testPasswordStrength = (newPassword: string) =>
  post<PasswordStrength>('frappe.core.doctype.user.user.test_password_strength', {
    new_password: newPassword,
  });
