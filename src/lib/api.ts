import { getToken } from "./auth";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:6001/v1";

interface ApiEnvelope<T> {
  status: boolean;
  statusCode: number;
  path: string;
  message: string;
  data?: T;
  errors?: { message?: string };
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const json = (await res.json()) as ApiEnvelope<T>;

  if (!json.status) {
    const msg = json.errors?.message || json.message || "Request failed";
    throw new Error(msg);
  }
  return json.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
};
