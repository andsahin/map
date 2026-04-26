"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { clearAuth, getToken, useAuthUser } from "@/lib/auth";
import { connectSocket, disconnectSocket } from "@/lib/socket";
import type { LiveLocation } from "@/lib/types";

const LiveMap = dynamic(() => import("@/components/LiveMap"), { ssr: false });

export default function AdminPage() {
  const router = useRouter();
  const user = useAuthUser();
  const [connected, setConnected] = useState(false);
  const [locationsById, setLocationsById] = useState<
    Record<string, LiveLocation>
  >({});

  useEffect(() => {
    const token = getToken();
    if (!user || !token) {
      router.replace("/login");
      return;
    }
    if (user.type !== "rider") {
      router.replace("/track");
      return;
    }

    const socket = connectSocket(token);
    setConnected(socket.connected);

    function onConnect() {
      console.log("[admin] socket connected", socket.id);
      setConnected(true);
    }

    function onDisconnect() {
      console.log("[admin] socket disconnected");
      setConnected(false);
      setLocationsById({});
    }

    function onSnapshot(list: LiveLocation[]) {
      console.log("[admin] locations:snapshot", list);
      const byId: Record<string, LiveLocation> = {};
      for (const l of list) byId[l.userId] = l;
      setLocationsById(byId);
    }

    function onLocationNew(loc: LiveLocation) {
      console.log("[admin] location:new", loc);
      setLocationsById((prev) => ({ ...prev, [loc.userId]: loc }));
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("locations:snapshot", onSnapshot);
    socket.on("location:new", onLocationNew);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("locations:snapshot", onSnapshot);
      socket.off("location:new", onLocationNew);
      disconnectSocket();
    };
  }, [user, router]);

  const locations = useMemo(
    () => Object.values(locationsById),
    [locationsById],
  );

  function logout() {
    disconnectSocket();
    clearAuth();
    router.replace("/login");
  }

  if (!user) return null;

  return (
    <main className="h-screen flex flex-col bg-slate-100">
      <header className="flex items-center justify-between bg-white p-4 shadow-sm">
        <div>
          <div className="font-bold text-slate-900">Admin — Live Tracking</div>
          <div className="text-xs text-slate-500 flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                connected ? "bg-green-500" : "bg-red-500"
              }`}
            />
            {connected ? "Connected" : "Disconnected"} · {locations.length}{" "}
            active user{locations.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600 hidden sm:inline">
            {user.name}
          </span>
          <button
            onClick={logout}
            className="text-sm px-3 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Log out
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row">
        <aside className="w-full md:w-80 bg-white border-r border-slate-200 overflow-y-auto max-h-48 md:max-h-none">
          <ul className="divide-y divide-slate-200">
            {locations.length === 0 && (
              <li className="p-4 text-sm text-slate-500">
                No active users yet
              </li>
            )}
            {locations.map((l) => (
              <li key={l.userId} className="p-3 hover:bg-slate-50">
                <div className="font-semibold text-slate-900">{l.name}</div>
                <div className="text-xs text-slate-500">{l.email}</div>
                <div className="text-xs text-slate-700 mt-1">
                  {l.latitude.toFixed(5)}, {l.longitude.toFixed(5)}
                </div>
                <div className="text-xs text-slate-400">
                  {new Date(l.updatedAt).toLocaleTimeString()}
                </div>
              </li>
            ))}
          </ul>
        </aside>
        <div className="flex-1 min-h-[400px]">
          <LiveMap locations={locations} />
        </div>
      </div>
    </main>
  );
}
