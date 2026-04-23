import { io, Socket } from "socket.io-client";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "http://localhost:6001";

let socket: Socket | null = null;
let currentToken: string | null = null;

export function connectSocket(token: string): Socket {
  if (socket && currentToken === token) return socket;

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  currentToken = token;
  socket = io(`${WS_URL}/tracking`, {
    auth: { token },
    transports: ["polling", "websocket"],
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
