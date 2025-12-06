import { saveCallRecord } from "./utils/saveCallRecord.js";

export default function registerCallHandlers(io) {
  // 🧠 Временные хранилища
  const socketRoles = new Map(); // socket.id → роль
  const roomCallers = new Map(); // roomId → { role, userId, name, connectionQuality }

  io.on("connection", (socket) => {
    const clientRole = socket.handshake.auth?.role || "unknown";
    const clientUserId = socket.handshake.auth?.userId || null;
    socketRoles.set(socket.id, clientRole);

    console.log(
      `🟢 [SOCKET] ${socket.id} подключился как ${clientRole} (${
        clientUserId || "без ID"
      })`
    );

    // === Подключение к комнате ===
    socket.on("chat:join", (roomId) => {
      roomId ||= "common-room";
      socket.join(roomId);
      console.log(`👥 [ROOM] ${socket.id} вошёл в комнату: ${roomId}`);
      socket.to(roomId).emit("chat:joined", socket.id);
    });

    // === OFFER === — инициатор звонка
    socket.on(
      "call:offer",
      ({
        roomId,
        offer,
        name,
        avatar,
        role,
        userId,
        userName,
        connectionQuality,
      }) => {
        if (!roomId || !offer) return;

        const callerRole = role || socketRoles.get(socket.id) || "unknown";
        console.log(`📞 [OFFER] от ${socket.id} (${callerRole})`);

        roomCallers.set(roomId, {
          role: callerRole,
          userId: userId || clientUserId,
          name: userName || name || callerRole,
          connectionQuality: connectionQuality || "unknown", // 👈 сохранение
        });

        socket.to(roomId).emit("call:offer", {
          from: socket.id,
          offer,
          name,
          avatar,
          role: callerRole,
        });
      }
    );

    // === ANSWER === — ответ второй стороны
    socket.on("call:answer", ({ roomId, answer, role }) => {
      if (!roomId || !answer) return;
      const answerRole = role || socketRoles.get(socket.id) || "unknown";
      console.log(`✅ [ANSWER] от ${socket.id} (${answerRole})`);
      socket
        .to(roomId)
        .emit("call:answer", { from: socket.id, answer, role: answerRole });
    });

    // === ICE ===
    socket.on("call:ice-candidate", ({ roomId, candidate }) => {
      if (!roomId || !candidate) return;
      socket
        .to(roomId)
        .emit("call:ice-candidate", { from: socket.id, candidate });
    });

    // === REJECT ===
    socket.on("call:reject", ({ roomId }) => {
      roomId ||= "common-room";
      console.log(`❌ [REJECT] ${socket.id} отклонил вызов`);
      socket.to(roomId).emit("call:rejected");
    });

    // === END === — завершение вызова
    socket.on("call:end", async (roomId, meta = {}) => {
      roomId ||= "common-room";

      const {
        startedAt,
        durationSec,
        userId,
        userName,
        connectionQuality = "unknown",
      } = meta;

      const initiator = roomCallers.get(roomId) || null;
      const currentRole = socketRoles.get(socket.id) || "unknown";

      console.log(
        `📴 [END] ${socket.id} (${currentRole}) завершил вызов | инициатор: ${
          initiator?.role || "?"
        }`
      );

      socket
        .to(roomId)
        .emit("call:end", { from: socket.id, role: currentRole });

      try {
        const endedAt = new Date();

        // формируем полный объект данных
        const callData = {
          roomId,
          startedAt: startedAt || endedAt,
          endedAt,
          durationSec: durationSec || 0,
          caller: initiator?.role || currentRole,
          callee: initiator
            ? currentRole
            : currentRole === "doctor"
            ? "patient"
            : "doctor",
          callerUserId: initiator?.userId || userId,
          calleeUserId: userId,
          callerName: initiator?.name || userName || "unknown",
          calleeName: userName || currentRole,
          type: "video",
          callerConnectionQuality: initiator?.connectionQuality || "unknown",
          calleeConnectionQuality: connectionQuality || "unknown",
        };

        await saveCallRecord(callData);
        console.log("✅ [END] Лог звонка сохранён:", callData);
      } catch (err) {
        console.error("⚠️ [END] Ошибка при сохранении:", err.message);
      } finally {
        roomCallers.delete(roomId);
      }
    });

    // === LEAVE / DISCONNECT ===
    socket.on("chat:leave", (roomId) => {
      roomId ||= "common-room";
      socket.leave(roomId);
      socket.to(roomId).emit("chat:left", socket.id);
      console.log(`🚪 [ROOM] ${socket.id} покинул комнату ${roomId}`);
    });

    socket.on("disconnect", (reason) => {
      console.log(`🔴 [DISCONNECT] ${socket.id} (${reason})`);
      socketRoles.delete(socket.id);
    });
  });

  console.log("✅ [SOCKET] registerCallHandlers инициализирован");
}
