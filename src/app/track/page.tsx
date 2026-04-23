"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { clearAuth, getToken, useAuthUser } from "@/lib/auth";
import { connectSocket, disconnectSocket } from "@/lib/socket";
import type { LocationPayload } from "@/lib/types";

interface LastPoint extends LocationPayload {
  timestamp: number;
}

export default function TrackPage() {
  const router = useRouter();
  const user = useAuthUser();
  const [sharing, setSharing] = useState(false);
  const [last, setLast] = useState<LastPoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!user || !token) {
      router.replace("/login");
      return;
    }
    if (user.role === "ADMIN") {
      router.replace("/admin");
      return;
    }
    connectSocket(token);

    return () => {
      stopWatch();
      disconnectSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function stopWatch() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setSharing(false);
  }

  function startWatch() {
    setError(null);
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by this browser");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const payload: LocationPayload = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? undefined,
          speed: pos.coords.speed ?? undefined,
          heading: pos.coords.heading ?? undefined,
        };
        setLast({ ...payload, timestamp: pos.timestamp });
        const socket = connectSocket(getToken() || "");
        console.log(
          "[track] emitting location:update, connected=",
          socket.connected,
          payload,
        );
        socket.emit("location:update", payload, (ack: unknown) => {
          console.log("[track] ack received:", ack);
          if (ack && typeof ack === "object" && "ok" in ack) {
            const ok = (ack as { ok: boolean }).ok;
            if (ok) setSentCount((c) => c + 1);
          }
        });
      },
      (err) => {
        setError(err.message);
        stopWatch();
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      },
    );
    watchIdRef.current = id;
    setSharing(true);
  }

  function logout() {
    stopWatch();
    disconnectSocket();
    clearAuth();
    router.replace("/login");
  }

  if (!user) return null;

  return (
    <main className="min-h-screen bg-slate-100 p-4">
      <div className="max-w-xl mx-auto space-y-4">
        <header className="flex items-center justify-between bg-white rounded-lg p-4 shadow">
          <div>
            <div className="font-bold text-slate-900">{user.name}</div>
            <div className="text-xs text-slate-500">{user.email}</div>
          </div>
          <button
            onClick={logout}
            className="text-sm px-3 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Log out
          </button>
        </header>

        <section className="bg-white rounded-lg p-5 shadow space-y-4">
          <h1 className="text-xl font-bold text-slate-900">Share Location</h1>
          {error && (
            <div className="p-2 bg-red-50 text-red-700 text-sm rounded">
              {error}
            </div>
          )}
          <div className="flex items-center gap-3">
            <span
              className={`inline-block w-3 h-3 rounded-full ${
                sharing ? "bg-green-500 animate-pulse" : "bg-slate-300"
              }`}
            />
            <span className="text-slate-700">
              {sharing ? "Sharing live location" : "Not sharing"}
            </span>
          </div>
          {!sharing ? (
            <button
              onClick={startWatch}
              className="w-full py-2 rounded bg-green-600 text-white font-semibold hover:bg-green-700"
            >
              Start sharing
            </button>
          ) : (
            <button
              onClick={stopWatch}
              className="w-full py-2 rounded bg-red-600 text-white font-semibold hover:bg-red-700"
            >
              Stop sharing
            </button>
          )}
          <div className="text-xs text-slate-500">
            Updates sent: <b>{sentCount}</b>
          </div>
        </section>

        {last && (
          <section className="bg-white rounded-lg p-5 shadow space-y-1 text-sm text-slate-700">
            <h2 className="font-semibold text-slate-900 mb-2">Last fix</h2>
            <div>
              <b>Lat:</b> {last.latitude.toFixed(6)}
            </div>
            <div>
              <b>Lng:</b> {last.longitude.toFixed(6)}
            </div>
            {last.accuracy !== undefined && (
              <div>
                <b>Accuracy:</b> {last.accuracy.toFixed(1)} m
              </div>
            )}
            {last.speed !== undefined && last.speed !== null && (
              <div>
                <b>Speed:</b> {last.speed.toFixed(1)} m/s
              </div>
            )}
            <div className="text-xs text-slate-500 pt-2">
              {new Date(last.timestamp).toLocaleTimeString()}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
