"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { clearAuth, getToken, useAuthUser } from "@/lib/auth";
import { connectSocket, disconnectSocket, getSocket } from "@/lib/socket";

const UPDATE_INTERVAL_MS = 3000;
const DEFAULT_RATING = 4.8;

interface LastFix {
  lat: number;
  lng: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  timestamp: number;
}

export default function TrackPage() {
  const router = useRouter();
  const user = useAuthUser();
  const [sharing, setSharing] = useState(false);
  const [last, setLast] = useState<LastFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const [connected, setConnected] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auth guard + socket lifecycle
  useEffect(() => {
    const token = getToken();
    if (!user || !token) {
      router.replace("/login");
      return;
    }
    if (user.type === "rider") {
      router.replace("/dashboard");
      return;
    }

    const socket = connectSocket(token);
    setConnected(socket.connected);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      stopSharing();
      disconnectSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /** Reads one GPS fix. */
  const readPosition = useCallback((): Promise<LastFix> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation not supported"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const fix: LastFix = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? undefined,
            speed: pos.coords.speed ?? undefined,
            heading: pos.coords.heading ?? undefined,
            timestamp: pos.timestamp,
          };
          console.log("[Driver] Got location fix:", fix);
          setLast(fix);
          resolve(fix);
        },
        (err) => reject(new Error(err.message)),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
      );
    });
  }, []);

  /** Pushes the latest fix to the backend via socket. */
  const pushUpdate = useCallback(
    (fix: LastFix) => {
      if (!user) return;
      const socket = getSocket();
      if (!socket || !socket.connected) return;

      const payload = {
        driverId: user.id,
        lat: fix.lat,
        lng: fix.lng,
        status: "available" as const,
        vehicleType: user.vehicleType ?? "car",
        rating: DEFAULT_RATING,
        heading: Math.max(0, Math.min(360, fix.heading ?? 0)),
        speedKmh: fix.speed ? Math.max(0, fix.speed * 3.6) : 0,
      };

      socket.emit("location:update", payload, (ack: unknown) => {
        if (
          ack &&
          typeof ack === "object" &&
          "success" in ack &&
          (ack as { success: boolean }).success
        ) {
          setSentCount((c) => c + 1);
        }
      });
    },
    [user],
  );

  function stopSharing() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setSharing(false);
  }

  async function startSharing() {
    setError(null);
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by this browser");
      return;
    }
    try {
      const first = await readPosition();
      pushUpdate(first);

      intervalRef.current = setInterval(async () => {
        try {
          const fix = await readPosition();
          pushUpdate(fix);
        } catch (err) {
          setError(err instanceof Error ? err.message : "GPS read failed");
        }
      }, UPDATE_INTERVAL_MS);

      setSharing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start sharing");
    }
  }

  function logout() {
    stopSharing();
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
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-slate-900">
              Driver Location
            </h1>
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                connected
                  ? "bg-green-100 text-green-700"
                  : "bg-slate-200 text-slate-600"
              }`}
            >
              {connected ? "Socket connected" : "Disconnected"}
            </span>
          </div>

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
              {sharing
                ? `Sharing live location (every ${UPDATE_INTERVAL_MS / 1000}s)`
                : "Not sharing"}
            </span>
          </div>

          {!sharing ? (
            <button
              onClick={startSharing}
              disabled={!connected}
              className="w-full py-2 rounded bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50"
            >
              Start sharing
            </button>
          ) : (
            <button
              onClick={stopSharing}
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
              <b>Lat:</b> {last.lat.toFixed(6)}
            </div>
            <div>
              <b>Lng:</b> {last.lng.toFixed(6)}
            </div>
            {last.accuracy !== undefined && (
              <div>
                <b>Accuracy:</b> {last.accuracy.toFixed(1)} m
              </div>
            )}
            {last.speed !== undefined && last.speed !== null && (
              <div>
                <b>Speed:</b> {(last.speed * 3.6).toFixed(1)} km/h
              </div>
            )}
            {last.heading !== undefined && last.heading !== null && (
              <div>
                <b>Heading:</b> {last.heading.toFixed(0)}°
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
