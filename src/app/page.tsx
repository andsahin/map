"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/lib/auth";

export default function Home() {
  const router = useRouter();
  const user = useAuthUser();

  useEffect(() => {
    if (user) {
      router.replace(user.type === "rider" ? "/dashboard" : "/track");
    }
  }, [user, router]);

  if (user) return null;

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-900 to-slate-700 text-white">
      <div className="max-w-md w-full space-y-6 text-center">
        <h1 className="text-4xl font-bold">Ride Tracker</h1>
        <p className="opacity-80">Real-time location tracking</p>
        <div className="flex gap-3 justify-center">
          <Link
            href="/login"
            className="px-5 py-2 rounded bg-white text-slate-900 font-semibold hover:bg-slate-100"
          >
            Log in
          </Link>
          <Link
            href="/register"
            className="px-5 py-2 rounded border border-white hover:bg-white hover:text-slate-900"
          >
            Sign up
          </Link>
        </div>
      </div>
    </main>
  );
}
