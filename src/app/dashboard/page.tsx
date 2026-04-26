"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { clearAuth, getToken, useAuthUser } from "@/lib/auth";

export default function DashboardPage() {
  const router = useRouter();
  const user = useAuthUser();

  useEffect(() => {
    const token = getToken();
    if (!user || !token) {
      router.replace("/login");
      return;
    }
    if (user.type === "driver") {
      router.replace("/track");
    }
  }, [user, router]);

  function logout() {
    clearAuth();
    router.replace("/login");
  }

  if (!user) return null;

  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-200 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <button
            onClick={logout}
            className="text-sm px-3 py-1 rounded border border-slate-300 text-slate-700 hover:bg-white"
          >
            Log out
          </button>
        </header>

        <section className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-slate-900 text-white flex items-center justify-center text-xl font-bold">
              {initials}
            </div>
            <div>
              <div className="text-xl font-semibold text-slate-900">
                {user.name}
              </div>
              <div className="text-sm text-slate-500">{user.email}</div>
              <span className="inline-block mt-1 text-xs uppercase tracking-wider bg-slate-100 text-slate-700 rounded px-2 py-0.5">
                {user.type}
              </span>
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-slate-500">User ID</dt>
              <dd className="font-mono text-slate-800 break-all">{user.id}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Account type</dt>
              <dd className="text-slate-800 capitalize">{user.type}</dd>
            </div>
          </dl>
        </section>

        <section className="bg-white rounded-2xl shadow p-6 space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Ready to go somewhere?
          </h2>
          <p className="text-sm text-slate-600">
            Get fare estimates, find nearby drivers and plan your route.
          </p>
          <Link
            href="/ride"
            className="inline-flex items-center justify-center w-full py-3 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800 transition"
          >
            Try Booking a Ride
          </Link>
        </section>
      </div>
    </main>
  );
}
