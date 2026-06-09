/**
 * KiranaOS browser API client.
 *
 * Step 9 scope:
 * - Connect frontend modules to existing backend routes without changing UI.
 * - Keep token handling small and localStorage-compatible.
 * - Do not execute any action automatically; existing UI must call these helpers.
 */

export const DEFAULT_API_BASE_URL = '/api';
export const TOKEN_STORAGE_KEY = 'kiranaos_access_token';

export class ApiError extends Error {
  constructor(message, { status, data, url, method } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.url = url;
    this.method = method;
  }
}

function getStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function saveAuthToken(token, storageKey = TOKEN_STORAGE_KEY) {
  if (!token) return;
  const storage = getStorage();
  if (storage) storage.setItem(storageKey, token);
}

export function getAuthToken(storageKey = TOKEN_STORAGE_KEY) {
  const storage = getStorage();
  return storage ? storage.getItem(storageKey) : null;
}

export function clearAuthToken(storageKey = TOKEN_STORAGE_KEY) {
  const storage = getStorage();
  if (storage) storage.removeItem(storageKey);
}

export function makeQueryString(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item);
      continue;
    }
    search.set(key, value);
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  const text = await response.text();
  return text ? { message: text } : null;
}

function unwrapApiResponse(data) {
  if (data && typeof data === 'object' && 'success' in data) {
    if (data.success === false) {
      throw new ApiError(data.error || data.message || 'API request failed', { data });
    }
    if ('data' in data) return data.data;
  }
  return data;
}

export function createApiClient({
  baseUrl = DEFAULT_API_BASE_URL,
  tokenProvider = getAuthToken,
  onUnauthorized,
  fetchImpl = globalThis.fetch?.bind(globalThis),
} = {}) {
  if (!fetchImpl) {
    throw new Error('fetch is not available in this browser/context');
  }

  async function request(method, path, { query, body, headers, ownerPin, raw = false } = {}) {
    const token = typeof tokenProvider === 'function' ? await tokenProvider() : tokenProvider;
    const url = `${baseUrl}${path}${makeQueryString(query)}`;
    const hasBody = body !== undefined && body !== null;

    const response = await fetchImpl(url, {
      method,
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(ownerPin ? { 'x-owner-pin': ownerPin } : {}),
        ...(headers || {}),
      },
      body: hasBody ? JSON.stringify(body) : undefined,
    });

    const data = await parseResponse(response);
    if (!response.ok) {
      if (response.status === 401 && typeof onUnauthorized === 'function') {
        onUnauthorized(data);
      }
      throw new ApiError(data?.error || data?.message || `HTTP ${response.status}`, {
        status: response.status,
        data,
        url,
        method,
      });
    }

    return raw ? data : unwrapApiResponse(data);
  }

  return {
    request,
    get: (path, options) => request('GET', path, options),
    post: (path, body, options = {}) => request('POST', path, { ...options, body }),
    patch: (path, body, options = {}) => request('PATCH', path, { ...options, body }),
    delete: (path, options) => request('DELETE', path, options),
  };
}

export const apiClient = createApiClient();
