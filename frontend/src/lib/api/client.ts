declare global {
  interface Window {
    csrf_token?: string;
  }
}

export interface FrappeErrorBody {
  message?: string;
  exc_type?: string;
  _server_messages?: string;
}

export class FrappeError extends Error {
  status: number;
  excType?: string;

  constructor(message: string, status: number, excType?: string) {
    super(message);
    this.name = 'FrappeError';
    this.status = status;
    this.excType = excType;
  }
}

const isUsableToken = (value?: string | null) =>
  Boolean(value) && value !== 'None' && value !== '{{ frappe.session.csrf_token }}';

const getCsrfToken = () => {
  if (isUsableToken(window.csrf_token)) return window.csrf_token as string;

  const meta = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
  return isUsableToken(meta) ? (meta as string) : '';
};

const parseServerMessages = (raw?: string) => {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as string[];
    const messages = parsed.map((entry) => {
      try {
        return (JSON.parse(entry) as { message?: string }).message || '';
      } catch {
        return entry;
      }
    });
    return messages.filter(Boolean).join(' ');
  } catch {
    return '';
  }
};

export const callMethod = async <T>(
  method: string,
  body?: Record<string, unknown>
): Promise<T> => {
  const csrfToken = getCsrfToken();

  const response = await fetch(`/api/method/${method}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(csrfToken ? { 'X-Frappe-CSRF-Token': csrfToken } : {}),
    },
    body: JSON.stringify(body || {}),
  });

  const text = await response.text();
  let payload: (FrappeErrorBody & Record<string, unknown>) | null = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const serverMessage = parseServerMessages(payload?._server_messages);
    throw new FrappeError(
      serverMessage || payload?.message || response.statusText,
      response.status,
      payload?.exc_type
    );
  }

  return payload as T;
};

export interface LoginResponse {
  message: string;
  home_page?: string;
  full_name?: string;
}

export const login = (usr: string, pwd: string) =>
  callMethod<LoginResponse>('login', { usr, pwd });

export const logout = () => callMethod<unknown>('logout');

export interface LoggedUserResponse {
  message: string;
}

export const getLoggedUser = async () => {
  const response = await fetch('/api/method/frappe.auth.get_logged_user', {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as LoggedUserResponse;
  return payload?.message && payload.message !== 'Guest' ? payload.message : null;
};
