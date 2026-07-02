import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:4000/api",
  headers: { "Content-Type": "application/json" },
});

type TokenGetter = () => Promise<string | null>;
let getToken: TokenGetter | null = null;

export function setAuthTokenGetter(fn: TokenGetter) {
  getToken = fn;
}

api.interceptors.request.use(async (config) => {
  const token = await getToken?.();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      window.location.href = "/sign-in";
    }
    return Promise.reject(error);
  }
);

export default api;
