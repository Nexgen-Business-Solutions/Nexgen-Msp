declare global {
  interface Window {
    csrf_token?: string;
    frappe?: { csrf_token?: string };
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

const decodeToken = (value?: string | null) => {
  if (!value) return '';

  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
};

const cookie = (name: string) =>
  decodeToken(
    document.cookie
      .split('; ')
      .find((row) => row.startsWith(`${name}=`))
      ?.split('=')[1]
  );

/**
 * The token this session expects, from wherever it is freshest.
 *
 * The page's own copy is only right until the session changes; the cookie is what Frappe
 * rewrites when it does. Reading one source alone is what turned a renewed session into
 * "Invalid Request" on every save.
 */
const getCsrfToken = () => {
  const candidates = [
    window.csrf_token,
    window.frappe?.csrf_token,
    document.querySelector('meta[name="csrf-token"]')?.getAttribute('content'),
    cookie('csrf_token'),
    cookie('csrftoken'),
  ];

  const found = candidates.map(decodeToken).find(isUsableToken);

  return found || '';
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

/**
 * Told when the server no longer knows who the caller is.
 *
 * The application already holds an authentication state and a guard that acts on it, so a
 * lost session is reported to that state rather than turned into a message each screen has
 * to render on its own.
 */
let onSessionLost: () => void = () => {};

export const setSessionLostHandler = (handler: () => void) => {
  onSessionLost = handler;
};

const csrfHeaders = (): Record<string, string> => {
  const token = getCsrfToken();
  return token ? { 'X-Frappe-CSRF-Token': token } : {};
};

/** What the session expects now, and whether it still knows the caller. */
const askTheSession = async () => {
  try {
    const response = await fetch('/api/method/nexgen_msp.api.core.endpoints.v1.get_csrf_token', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) return { token: '', authenticated: false };

    const payload = (await response.json()) as {
      message?: { csrf_token?: string; authenticated?: boolean };
    };
    const fresh = payload?.message?.csrf_token;

    if (isUsableToken(fresh)) {
      window.csrf_token = fresh;
    }

    return {
      token: isUsableToken(fresh) ? (fresh as string) : '',
      authenticated: Boolean(payload?.message?.authenticated),
    };
  } catch {
    // offline, or nothing answering: not a reason to sign anyone out
    return { token: '', authenticated: true };
  }
};

export const request = async <T>(
  method: string,
  options: RequestOptions = {},
  retried = false
): Promise<T> => {
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
        ...csrfHeaders(),
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

  // Frappe answers `{"message": null}` when a method returns nothing, so the key has to
  // decide, not its value: `?? payload` handed the envelope back as if it were the answer
  const body = (payload && 'message' in payload ? payload.message : payload) as
    | (FrappeErrorBody & Record<string, unknown>)
    | null;

  if (!response.ok) {
    const serverMessage = parseServerMessages(payload?._server_messages);
    const structured = body && typeof body === 'object' ? body : null;

    // a session renewed since the page was served: take the token it expects and try once
    if (!retried && !isGet && payload?.exc_type === 'CSRFTokenError') {
      const { token, authenticated } = await askTheSession();

      if (!authenticated) {
        onSessionLost();
      } else if (token && token !== csrfToken) {
        return request<T>(method, options, true);
      }
    }

    if (response.status === 401) {
      onSessionLost();
    }

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

/** A multipart write, carried by the same rules as every other one. */
export const postForm = async <T>(method: string, body: FormData, retried = false): Promise<T> => {
  const csrfToken = getCsrfToken();

  const response = await fetch(`/api/method/${method}`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', ...csrfHeaders() },
    body,
  });

  const payload = (await response.json().catch(() => null)) as
    | (FrappeErrorBody & Record<string, unknown>)
    | null;
  const message = (payload && 'message' in payload ? payload.message : payload) as
    | (FrappeErrorBody & Record<string, unknown>)
    | null;

  if (!response.ok || message?.success === false) {
    if (!retried && payload?.exc_type === 'CSRFTokenError') {
      const { token, authenticated } = await askTheSession();

      if (!authenticated) {
        onSessionLost();
      } else if (token && token !== csrfToken) {
        return postForm<T>(method, body, true);
      }
    }

    if (response.status === 401) {
      onSessionLost();
    }

    throw new FrappeError(
      stripHtml(
        message?.error ||
          parseServerMessages(payload?._server_messages) ||
          (payload?.message as string) ||
          response.statusText
      ),
      response.status,
      message?.code,
      payload?.exc_type
    );
  }

  return message as T;
};

/**
 * A file the server streams, fetched under the same rules as everything else.
 *
 * A download used to be a bare <a href> to /api/method/…: no error parsing, and a session
 * that had ended answered with Frappe's own error page inside a saved file rather than
 * sending anyone back to the login.
 */
export const download = async (
  method: string,
  params: Record<string, unknown> = {},
  fallbackName = 'download'
): Promise<void> => {
  const response = await fetch(`/api/method/${method}${buildQuery(params)}`, {
    credentials: 'include',
    headers: { ...csrfHeaders() },
  });

  if (!response.ok) {
    if (response.status === 401) onSessionLost();

    let payload: FrappeErrorBody | null = null;

    try {
      payload = JSON.parse(await response.text()) as FrappeErrorBody;
    } catch {
      payload = null;
    }

    throw new FrappeError(
      stripHtml(
        parseServerMessages(payload?._server_messages) ||
          (payload?.message as string) ||
          response.statusText
      ),
      response.status,
      undefined,
      payload?.exc_type
    );
  }

  const disposition = response.headers.get('Content-Disposition') || '';
  const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);

  // a link click is never caught by a popup blocker, unlike window.open
  const link = document.createElement('a');
  link.href = href;
  link.download = decodeURIComponent(named?.[1] || fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
};

export const logout = () => post<unknown>('logout');

