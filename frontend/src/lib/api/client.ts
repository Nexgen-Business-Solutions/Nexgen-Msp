declare global {
  interface Window {
    csrf_token?: string;
  }
}

export interface FrappeErrorBody {
  message?: string;
  exc_type?: string;
  _server_messages?: string;
  success?: boolean;
  error?: string;
  code?: string;
}

export class FrappeError extends Error {
  status: number;
  code?: string;
  excType?: string;

  constructor(message: string, status: number, code?: string, excType?: string) {
    super(message);
    this.name = 'FrappeError';
    this.status = status;
    this.code = code;
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

const stripHtml = (value: string) => value.replace(/<[^>]+>/g, '').trim();

export type RequestOptions = {
  method?: 'GET' | 'POST';
  params?: Record<string, unknown>;
  signal?: AbortSignal;
};

const buildQuery = (params?: Record<string, unknown>) => {
  if (!params) return '';
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
};

export const request = async <T>(method: string, options: RequestOptions = {}): Promise<T> => {
  const { method: verb = 'POST', params, signal } = options;
  const csrfToken = getCsrfToken();
  const isGet = verb === 'GET';

  const response = await fetch(
    `/api/method/${method}${isGet ? buildQuery(params) : ''}`,
    {
      method: verb,
      credentials: 'include',
      signal,
      headers: {
        Accept: 'application/json',
        ...(isGet ? {} : { 'Content-Type': 'application/json' }),
        ...(csrfToken ? { 'X-Frappe-CSRF-Token': csrfToken } : {}),
      },
      ...(isGet ? {} : { body: JSON.stringify(params || {}) }),
    }
  );

  const text = await response.text();
  let payload: (FrappeErrorBody & Record<string, unknown>) | null = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  const body = (payload?.message ?? payload) as
    | (FrappeErrorBody & Record<string, unknown>)
    | null;

  if (!response.ok) {
    const serverMessage = parseServerMessages(payload?._server_messages);
    const structured = body && typeof body === 'object' ? body : null;

    throw new FrappeError(
      stripHtml(
        structured?.error || serverMessage || (payload?.message as string) || response.statusText
      ),
      response.status,
      structured?.code,
      payload?.exc_type
    );
  }

  if (body && typeof body === 'object' && body.success === false) {
    throw new FrappeError(stripHtml(body.error || 'Request failed.'), 400, body.code);
  }

  return body as T;
};

export const get = <T>(method: string, params?: Record<string, unknown>, signal?: AbortSignal) =>
  request<T>(method, { method: 'GET', params, signal });

export const post = <T>(method: string, params?: Record<string, unknown>, signal?: AbortSignal) =>
  request<T>(method, { method: 'POST', params, signal });

export interface LoginResponse {
  message: string;
  home_page?: string;
  full_name?: string;
}

export const login = async (usr: string, pwd: string) => {
  const csrfToken = getCsrfToken();

  const response = await fetch('/api/method/login', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(csrfToken ? { 'X-Frappe-CSRF-Token': csrfToken } : {}),
    },
    body: JSON.stringify({ usr, pwd }),
  });

  const text = await response.text();
  let payload: FrappeErrorBody | null = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new FrappeError(
      stripHtml(parseServerMessages(payload?._server_messages) || payload?.message || response.statusText),
      response.status,
      undefined,
      payload?.exc_type
    );
  }

  return payload as LoginResponse;
};

export const logout = () => post<unknown>('logout');

export const getLoggedUser = async () => {
  const response = await fetch('/api/method/frappe.auth.get_logged_user', {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as { message?: string };
  return payload?.message && payload.message !== 'Guest' ? payload.message : null;
};
