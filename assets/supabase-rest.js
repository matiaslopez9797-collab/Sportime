import { CONFIG } from './config.js';

const SESSION_KEY = 'sportime.web.session.v1';

export class ApiError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

function readSession() {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return value && value.access_token && value.refresh_token ? value : null;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveSession(value) {
  if (!value) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, JSON.stringify(value));
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const type = response.headers.get('content-type') || '';
  const value = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message = value?.msg || value?.message || value?.error_description || value?.error || String(value || `Error ${response.status}`);
    throw new ApiError(message, response.status, value);
  }
  return value;
}

export class SportimeApi extends EventTarget {
  constructor() {
    super();
    this.base = CONFIG.supabaseUrl.replace(/\/$/, '');
    this.key = CONFIG.supabasePublishableKey;
    this.session = readSession();
    this.refreshPromise = null;
  }

  get user() {
    return this.session?.user || null;
  }

  setSession(session) {
    this.session = session || null;
    saveSession(this.session);
    this.dispatchEvent(new CustomEvent('session', { detail: this.session }));
  }

  async request(path, { method = 'GET', body, token = true, headers = {}, retry = true } = {}) {
    if (token) await this.ensureFreshSession();
    const authToken = token && this.session?.access_token ? this.session.access_token : this.key;
    const requestHeaders = {
      apikey: this.key,
      Authorization: `Bearer ${authToken}`,
      Accept: 'application/json',
      ...headers
    };
    if (body !== undefined && !(body instanceof Blob) && !(body instanceof FormData)) {
      requestHeaders['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const response = await fetch(`${this.base}${path}`, { method, headers: requestHeaders, body });
    if (response.status === 401 && retry && this.session?.refresh_token) {
      await this.refresh();
      return this.request(path, { method, body: body && typeof body === 'string' ? JSON.parse(body) : body, token, headers, retry: false });
    }
    return parseResponse(response);
  }

  async ensureFreshSession() {
    if (!this.session) return;
    const expiresAt = Number(this.session.expires_at || 0) * 1000;
    if (expiresAt && expiresAt - Date.now() < 60000) await this.refresh();
  }

  async refresh() {
    if (!this.session?.refresh_token) return null;
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', token: false, retry: false, body: { refresh_token: this.session.refresh_token }
    }).then(session => {
      this.setSession(session);
      return session;
    }).catch(error => {
      this.setSession(null);
      throw error;
    }).finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  async signIn(email, password) {
    const session = await this.request('/auth/v1/token?grant_type=password', {
      method: 'POST', token: false, body: { email, password }
    });
    this.setSession(session);
    return session;
  }

  async signUp(email, password, data) {
    const result = await this.request('/auth/v1/signup', {
      method: 'POST', token: false, body: { email, password, data }
    });
    if (result.access_token) this.setSession(result);
    return result;
  }

  async resetPassword(email) {
    const redirectTo = `${location.origin}${location.pathname}`;
    return this.request('/auth/v1/recover', { method: 'POST', token: false, body: { email, redirect_to: redirectTo } });
  }

  async consumeAuthCallback() {
    const raw = location.hash.startsWith('#') ? location.hash.slice(1) : '';
    const params = new URLSearchParams(raw);
    if (params.get('error_description')) throw new ApiError(params.get('error_description'));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) return null;
    const expiresIn = Number(params.get('expires_in') || 3600);
    const session = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: params.get('token_type') || 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + Math.max(60, expiresIn)
    };
    this.setSession(session);
    try {
      const user = await this.request('/auth/v1/user', { retry: false });
      this.setSession({ ...session, user });
    } catch (error) {
      this.setSession(null);
      throw error;
    }
    history.replaceState(null, '', `${location.pathname}${location.search}#inicio`);
    return params.get('type') || 'authenticated';
  }

  async updatePassword(password) {
    if (!this.session) throw new ApiError('El enlace de recuperación ya no es válido.');
    const user = await this.request('/auth/v1/user', { method: 'PUT', body: { password } });
    this.setSession({ ...this.session, user });
    return user;
  }

  async signOut() {
    try {
      if (this.session) await this.request('/auth/v1/logout', { method: 'POST', retry: false });
    } finally {
      this.setSession(null);
    }
  }

  async profile() {
    if (!this.user) return null;
    const rows = await this.rest('profiles', {
      query: { select: 'id,email,full_name,phone,dni,birth_date,address,role', id: `eq.${this.user.id}`, limit: '1' }
    });
    return rows[0] || null;
  }

  async rest(table, { method = 'GET', query = {}, body, prefer, token = true } = {}) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.append(key, String(value));
    });
    const suffix = params.size ? `?${params}` : '';
    const headers = prefer ? { Prefer: prefer } : {};
    return this.request(`/rest/v1/${encodeURIComponent(table)}${suffix}`, { method, body, token, headers });
  }

  rpc(name, body = {}, { token = true } = {}) {
    if (!/^[a-z0-9_]+$/i.test(name)) throw new ApiError('Nombre de operación inválido.');
    return this.request(`/rest/v1/rpc/${name}`, { method: 'POST', body, token });
  }

  async upload(bucket, path, blob) {
    const safeBucket = encodeURIComponent(bucket);
    const safePath = path.split('/').map(encodeURIComponent).join('/');
    return this.request(`/storage/v1/object/${safeBucket}/${safePath}`, {
      method: 'POST', body: blob, headers: { 'Content-Type': blob.type, 'x-upsert': 'false' }
    });
  }

  async removeStorageObjects(bucket, paths) {
    return this.request(`/storage/v1/object/${encodeURIComponent(bucket)}`, {
      method: 'DELETE', body: { prefixes: paths }
    });
  }

  publicObjectUrl(bucket, path) {
    return `${this.base}/storage/v1/object/public/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  }
}
