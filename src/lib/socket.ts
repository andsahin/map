
import { io, Socket } from "socket.io-client";

// Support both local and production URLs
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "http://localhost:6001";

// Helper to extract origin and path for Socket.IO
function getSocketConfig() {
  try {
    const url = new URL(WS_URL);
    return {
      origin: url.origin,
      path: url.pathname.replace(/\/$/, "") + "/socket.io"
    };
  } catch {
    // fallback for plain host
    return { origin: WS_URL, path: "/socket.io" };
  }
}

let socket: Socket | null = null;
let currentToken: string | null = null;

export function connectSocket(token: string): Socket {
  if (socket && currentToken === token) return socket;

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  currentToken = token;
  const { origin, path } = getSocketConfig();
  socket = io(origin + "/drivers", {
    path,
    auth: { token },
    transports: ["websocket", "polling"],
    autoConnect: true,
    reconnection: true,
  });

  if (process.env.NODE_ENV !== "production") {
    socket.on("connect", () =>
      console.log("[socket] connected", socket?.id),
    );
    socket.on("connect_error", (err) =>
      console.warn("[socket] connect_error:", err.message),
    );
    socket.on("disconnect", (reason) =>
      console.log("[socket] disconnected:", reason),
    );
  }

  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    currentToken = null;
  }
}
