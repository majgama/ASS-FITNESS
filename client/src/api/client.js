const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3333/api';

let authToken = localStorage.getItem('assFitnessToken');

export function setAuthToken(token) {
  authToken = token;
  if (token) {
    localStorage.setItem('assFitnessToken', token);
  } else {
    localStorage.removeItem('assFitnessToken');
  }
}

export function getAuthToken() {
  return authToken;
}

function buildHeaders(body, headers = {}) {
  const result = { ...headers };
  if (!(body instanceof FormData)) {
    result['Content-Type'] = 'application/json';
  }
  if (authToken) {
    result.Authorization = `Bearer ${authToken}`;
  }
  return result;
}

export async function api(path, options = {}) {
  const body = options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: buildHeaders(options.body, options.headers),
    body
  });

  if (response.status === 204) return null;

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || 'Erro na requisicao.');
    error.code = data.error?.code;
    error.details = data.error?.details;
    error.status = response.status;
    throw error;
  }

  return data;
}

export function fileUrl(path) {
  if (!path) return '';
  const token = getAuthToken();
  const query = token ? `?access_token=${encodeURIComponent(token)}` : '';
  return `${API_URL}/files/${path}${query}`;
}

export function gifLibraryFileUrl(gifId) {
  if (!gifId) return '';
  const token = getAuthToken();
  const query = token ? `?access_token=${encodeURIComponent(token)}` : '';
  return `${API_URL}/gif-library/file/${gifId}${query}`;
}
