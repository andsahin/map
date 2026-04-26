"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { saveAuth } from "@/lib/auth";
import type { AuthResponse, UserType, VehicleType } from "@/lib/types";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [type, setType] = useState<UserType>("rider");
  const [vehicleType, setVehicleType] = useState<VehicleType>("car");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Save location to localStorage for use in /ride or /track
  function saveLocation(lat: number, lng: number) {
    try {
      localStorage.setItem("ride_lat", String(lat));
      localStorage.setItem("ride_lng", String(lng));
    } catch {}
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await api.post<AuthResponse>("/auth/register", {
        name,
        email,
        password,
        type,
        ...(type === "driver" ? { vehicleType } : {}),
      });
      // Immediately get live location after register
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          saveLocation(pos.coords.latitude, pos.coords.longitude);
          saveAuth(data.accessToken, data.user);
          router.replace(data.user.type === "rider" ? "/dashboard" : "/track");
        },
        () => {
          // If denied, still proceed
          saveAuth(data.accessToken, data.user);
          router.replace(data.user.type === "rider" ? "/dashboard" : "/track");
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
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
        <h1 className="text-2xl font-bold text-slate-900">Sign up</h1>
        {error && (
          <div className="p-2 bg-red-50 text-red-700 text-sm rounded">
            {error}
          </div>
        )}
        <label className="block">
          <span className="text-sm text-slate-700">Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-slate-900"
          />
        </label>
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
        <label className="block">
          <span className="text-sm text-slate-700">Account type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as UserType)}
            className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-slate-900"
          >
            <option value="rider">Rider (book a ride)</option>
            <option value="driver">Driver (share location)</option>
          </select>
        </label>

        {type === "driver" && (
          <label className="block">
            <span className="text-sm text-slate-700">Vehicle type</span>
            <select
              value={vehicleType}
              onChange={(e) => setVehicleType(e.target.value as VehicleType)}
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-slate-900"
            >
              <option value="car">Car</option>
              <option value="bike">Bike</option>
              <option value="cng">CNG</option>
            </select>
          </label>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 rounded bg-slate-900 text-white font-semibold disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create account"}
        </button>
        <p className="text-sm text-slate-600 text-center">
          Have an account?{" "}
          <Link href="/login" className="text-blue-600 hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </main>
  );
}
