import axios from 'axios';

/**
 * The single HTTP client for the app: base URL, auth header and shared error
 * handling live here so no page has to repeat them.
 */
const api = axios.create({
  baseURL:
    process.env.REACT_APP_API_URL ||
    (window.location.hostname.includes('onrender.com')
      ? 'https://news-curator-deployed.onrender.com/api'
      : 'http://localhost:5000/api'),
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // An expired session should return the reader to sign-in rather than
    // leaving them on a page whose actions all silently fail.
    if (error.response?.status === 401 && localStorage.getItem('token')) {
      localStorage.removeItem('token');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
    }
    // Errors are surfaced in the UI; log detail only while developing.
    if (process.env.NODE_ENV === 'development') {
      console.error(
        `API ${error.config?.method?.toUpperCase() || ''} ${error.config?.url || ''} →`,
        error.response?.status || error.message
      );
    }
    return Promise.reject(error);
  }
);

export default api;
