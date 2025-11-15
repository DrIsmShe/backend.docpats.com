import http from "http";
import { Server } from "socket.io";
import app from "./app.js";

// === Импорты модулей ===
import registerNotificationSockets from "./sockets/notificationsSockets.js";
import registerChatSockets from "./sockets/chatSockets.js";
import registerCallSockets from "./sockets/callSockets.js";
import registerStatusSockets from "./sockets/statusSockets.js";

const server = http.createServer(app);

// === Socket.IO конфигурация ===
export const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "https://frontend-docpats.netlify.app"],
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"], // важно для Render/Netlify
  pingTimeout: 60000, // увеличить таймауты
  pingInterval: 25000,
});

global.io = io;

const onlineUsers = new Map();

io.on("connection", (socket) => {
  console.log(`🟢 Новый сокет ${socket.id}`);

  const { userId } = socket.handshake.auth || {};
  if (!userId) {
    console.log("⚠️ Socket без userId отключён");
    socket.disconnect();
    return;
  }

  socket.userId = userId;
  onlineUsers.set(userId, socket.id);
  socket.join(userId);

  // === Подключаем модули ===
  registerNotificationSockets(io, socket, onlineUsers);
  registerChatSockets(io, socket, onlineUsers);
  registerCallSockets(io, socket, onlineUsers);
  registerStatusSockets(io, socket, onlineUsers);

  socket.on("disconnect", () => {
    onlineUsers.delete(userId);
    io.emit("userStatusUpdate", { userId, status: "offline" });
    console.log(`🔴 Socket отключился: ${socket.id}`);
  });
});

export default server;
