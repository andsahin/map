"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { saveAuth } from "@/lib/auth";
import type { AuthResponse } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await api.post<AuthResponse>("/auth/login", {
        email,
        password,
      });
      saveAuth(data.accessToken, data.user);
      router.replace(data.user.role === "ADMIN" ? "/admin" : "/track");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-slate-100">
      <form
        onSubmit={onSubmit}
        className="max-w-sm w-full bg-white p-6 rounded-lg shadow space-y-4"
      >
        <h1 className="text-2xl font-bold text-slate-900">Log in</h1>
        {error && (
          <div className="p-2 bg-red-50 text-red-700 text-sm rounded">
            {error}
          </div>
        )}
        <label className="block">
          <span className="text-sm text-slate-700">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-slate-900"
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-700">Password</span>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-slate-900"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 rounded bg-slate-900 text-white font-semibold disabled:opacity-50"
        >
          {loading ? "Logging in..." : "Log in"}
        </button>
        <p className="text-sm text-slate-600 text-center">
          No account?{" "}
          <Link href="/register" className="text-blue-600 hover:underline">
            Register
          </Link>
        </p>
      </form>
    </main>
  );
}
