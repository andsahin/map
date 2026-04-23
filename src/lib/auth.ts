import { useSyncExternalStore } from "react";
import type { AuthUser } from "./types";

const TOKEN_KEY = "ride_token";
const USER_KEY = "ride_user";
const AUTH_EVENT = "ride:auth-changed";

let cachedRaw: string | null = null;
let cachedUser: AuthUser | null = null;

function readUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (raw === cachedRaw) return cachedUser;
  cachedRaw = raw;
  if (!raw) {
    cachedUser = null;
    return null;
  }
  try {
    cachedUser = JSON.parse(raw) as AuthUser;
  } catch {
    cachedUser = null;
  }
  return cachedUser;
}

function notifyAuthChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_EVENT));
}

export function saveAuth(token: string, user: AuthUser) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  notifyAuthChange();
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): AuthUser | null {
  return readUser();
}

export function clearAuth() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  notifyAuthChange();
}

function subscribeAuth(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === USER_KEY || e.key === TOKEN_KEY) callback();
  };
  window.addEventListener(AUTH_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(AUTH_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

const getServerUser = () => null;

export function useAuthUser(): AuthUser | null {
  return useSyncExternalStore(subscribeAuth, readUser, getServerUser);
}
